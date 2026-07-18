#define DEBUG
#define pr_fmt(fmt) "virtio-wasm: " fmt

#include <asm/wasm_imports.h>
#include <linux/device.h>
#include <linux/interrupt.h>
#include <linux/irq.h>
#include <linux/mod_devicetable.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/smp.h>
#include <linux/virtio_config.h>
#include <linux/virtio_ring.h>
#include <linux/virtio.h>

#define to_virtio_wasm_device(_plat_dev) \
	container_of(_plat_dev, struct virtio_wasm_device, vdev)

struct virtio_wasm_device {
	struct virtio_device vdev;
	struct platform_device *pdev;
	int config_irq;

	u32 host_id;
	u8 status;
	u64 features;

	u8 *config;
	u32 config_len;
};

/* per-virtqueue state, stored in vq->priv */
struct virtio_wasm_vq {
	int irq;
	char *irq_name;
	/* affinity was chosen explicitly; vw_notify must not steer it */
	bool has_affinity;
	int last_cpu;
};

static void vw_get(struct virtio_device *vdev, unsigned offset, void *buf,
		   unsigned len)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	len = min_t(size_t, len, vw_dev->config_len - offset);
	memcpy(buf, vw_dev->config + offset, len);
}

static void vw_set(struct virtio_device *vdev, unsigned offset, const void *buf,
		   unsigned len)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);

	if (offset + len > vw_dev->config_len) {
		pr_warn("attempted config write out of bounds: %u+%u > %u\n",
			offset, len, vw_dev->config_len);
		return;
	}

	memcpy(vw_dev->config + offset, buf, len);
}

static void _notify(void *arg)
{
	struct virtqueue *vq = arg;
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vq->vdev);
	wasm_virtio_notify(vw_dev->host_id, vq->index);
}

static bool vw_notify(struct virtqueue *vq)
{
	struct virtio_wasm_vq *vw_vq = vq->priv;
	int cpu = raw_smp_processor_id();

	/* absent an explicit affinity, completions follow the submitter */
	if (!READ_ONCE(vw_vq->has_affinity) && cpu != vw_vq->last_cpu) {
		vw_vq->last_cpu = cpu;
		irq_set_affinity(vw_vq->irq, cpumask_of(cpu));
	}

	wasm_kernel_run_on_main(_notify, vq);
	return true;
}

static u8 vw_get_status(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->status;
}
static void vw_set_status(struct virtio_device *vdev, u8 status)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	if (vw_dev->status != status) {
		const char *name = dev_name(&vdev->dev);
		u8 changed = vw_dev->status ^ status;
		vw_dev->status = status;
		if (changed & VIRTIO_CONFIG_S_ACKNOWLEDGE)
			pr_debug("device %s: acknowledge = %d\n", name,
				 !!(status & VIRTIO_CONFIG_S_ACKNOWLEDGE));
		if (changed & VIRTIO_CONFIG_S_DRIVER)
			pr_debug("device %s: driver = %d\n", name,
				 !!(status & VIRTIO_CONFIG_S_DRIVER));
		if (changed & VIRTIO_CONFIG_S_FAILED)
			pr_debug("device %s: failed = %d\n", name,
				 !!(status & VIRTIO_CONFIG_S_FAILED));
		if (changed & VIRTIO_CONFIG_S_DRIVER_OK)
			pr_debug("device %s: driver ok = %d\n", name,
				 !!(status & VIRTIO_CONFIG_S_DRIVER_OK));
		if (changed & VIRTIO_CONFIG_S_FEATURES_OK)
			pr_debug("device %s: features ok = %d\n", name,
				 !!(status & VIRTIO_CONFIG_S_FEATURES_OK));
	}
}
static void vw_reset(struct virtio_device *vdev)
{
	vw_set_status(vdev, 0);
}

/*
 * Runs asynchronously on the main thread, by which time the virtqueue may
 * already be freed, so the ids travel by value in the pointer.
 */
static void _disable(void *arg)
{
	uintptr_t packed = (uintptr_t)arg;

	wasm_virtio_disable_vring(packed >> 16, packed & 0xffff);
}

static int vw_set_vq_affinity(struct virtqueue *vq,
			      const struct cpumask *cpu_mask)
{
	struct virtio_wasm_vq *vw_vq = vq->priv;

	if (!cpu_mask) {
		/* return the queue to follow-the-submitter steering */
		WRITE_ONCE(vw_vq->has_affinity, false);
		return 0;
	}

	WRITE_ONCE(vw_vq->has_affinity, true);
	return irq_set_affinity(vw_vq->irq, cpu_mask);
}

static const struct cpumask *vw_get_vq_affinity(struct virtio_device *vdev,
						int index)
{
	struct virtqueue *vq;

	list_for_each_entry(vq, &vdev->vqs, list) {
		if (vq->index == index) {
			struct virtio_wasm_vq *vw_vq = vq->priv;
			return irq_get_affinity_mask(vw_vq->irq);
		}
	}

	return NULL;
}

static void vw_del_vqs(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	struct virtqueue *vq, *n;

	list_for_each_entry_safe(vq, n, &vdev->vqs, list) {
		struct virtio_wasm_vq *vw_vq = vq->priv;
		uintptr_t packed = vw_dev->host_id << 16 | vq->index;

		wasm_kernel_run_on_main(_disable, (void *)packed);
		free_irq(vw_vq->irq, vq);
		wasm_free_irq(vw_vq->irq);
		vring_del_virtqueue(vq);
		kfree(vw_vq->irq_name);
		kfree(vw_vq);
	}

	free_irq(vw_dev->config_irq, vw_dev);
}

static irqreturn_t vw_config_interrupt(int irq, void *dev)
{
	struct virtio_wasm_device *vw_dev = dev;

	virtio_config_changed(&vw_dev->vdev);
	return IRQ_HANDLED;
}

static void _enable(void *arg)
{
	struct virtqueue *vq = arg;
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vq->vdev);
	struct virtio_wasm_vq *vw_vq = vq->priv;

	wasm_virtio_enable_vring(vw_dev->host_id, vq->index,
				 virtqueue_get_vring_size(vq),
				 virtqueue_get_desc_addr(vq), vw_vq->irq);
}

static struct virtqueue *vw_setup_vq(struct virtio_device *vdev, unsigned index,
				     vq_callback_t *callback, const char *name,
				     bool ctx)
{
	struct virtio_wasm_vq *vw_vq;
	struct virtqueue *vq;
	int num = 256;
	int rc;

	vw_vq = kzalloc(sizeof(*vw_vq), GFP_KERNEL);
	if (!vw_vq)
		return ERR_PTR(-ENOMEM);
	vw_vq->last_cpu = -1;

	vw_vq->irq = wasm_alloc_irq();
	if (vw_vq->irq < 0) {
		rc = vw_vq->irq;
		goto free_vw_vq;
	}

	vw_vq->irq_name = kasprintf(GFP_KERNEL, "%s-%s", dev_name(&vdev->dev),
				    name);
	if (!vw_vq->irq_name) {
		rc = -ENOMEM;
		goto free_irq_nr;
	}

	vq = vring_create_virtqueue(index, num, PAGE_SIZE, vdev, true, true,
				    ctx, vw_notify, callback, name);
	if (!vq) {
		rc = -ENOMEM;
		goto free_name;
	}
	vq->num_max = num;
	vq->priv = vw_vq;

	rc = request_irq(vw_vq->irq, vring_interrupt, 0, vw_vq->irq_name, vq);
	if (rc)
		goto del_vring;

	wasm_kernel_run_on_main(_enable, vq);

	return vq;

del_vring:
	vring_del_virtqueue(vq);
free_name:
	kfree(vw_vq->irq_name);
free_irq_nr:
	wasm_free_irq(vw_vq->irq);
free_vw_vq:
	kfree(vw_vq);
	return ERR_PTR(rc);
}

static int vw_find_vqs(struct virtio_device *vdev, unsigned nvqs,
		       struct virtqueue *vqs[], vq_callback_t *callbacks[],
		       const char *const names[], const bool *ctx,
		       struct irq_affinity *desc)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	struct irq_affinity_desc *masks = NULL;
	int i, queue_idx = 0, rc;

	rc = request_irq(vw_dev->config_irq, vw_config_interrupt, 0,
			 dev_name(&vdev->dev), vw_dev);
	if (rc)
		return rc;

	if (desc)
		masks = irq_create_affinity_masks(nvqs, desc);

	for (i = 0; i < nvqs; ++i) {
		if (!names[i]) {
			vqs[i] = NULL;
			continue;
		}
		vqs[i] = vw_setup_vq(vdev, queue_idx++, callbacks[i], names[i],
				     ctx ? ctx[i] : false);
		if (IS_ERR(vqs[i])) {
			rc = PTR_ERR(vqs[i]);
			goto error;
		}
		if (masks)
			vw_set_vq_affinity(vqs[i], &masks[i].mask);
	}

	kfree(masks);
	return 0;
error:
	kfree(masks);
	vw_del_vqs(vdev);
	return rc;
}

static u64 vw_get_features(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->features;
}

static void _finalize_features(void *arg)
{
	struct virtio_device *vdev = arg;
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	wasm_virtio_set_features(vw_dev->host_id, vdev->features);
}

static int vw_finalize_features(struct virtio_device *vdev)
{
	vring_transport_features(vdev);
	wasm_kernel_run_on_main(_finalize_features, vdev);
	return 0;
}

static const char *vw_bus_name(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->pdev->name;
}

static const struct virtio_config_ops virtio_wasm_config_ops = {
	.get = vw_get,
	.set = vw_set,
	.get_status = vw_get_status,
	.set_status = vw_set_status,
	.reset = vw_reset,
	.find_vqs = vw_find_vqs,
	.del_vqs = vw_del_vqs,
	.get_features = vw_get_features,
	.finalize_features = vw_finalize_features,
	.bus_name = vw_bus_name,
	.set_vq_affinity = vw_set_vq_affinity,
	.get_vq_affinity = vw_get_vq_affinity,
};

static void virtio_wasm_release_dev(struct device *_d)
{
	struct virtio_device *vdev = dev_to_virtio(_d);
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	kfree(vw_dev);
}

static void _setup(void *arg)
{
	struct virtio_wasm_device *vw_dev = arg;
	wasm_virtio_setup(vw_dev->host_id, vw_dev->config_irq, vw_dev->config,
			  vw_dev->config_len);
}

static int virtio_wasm_probe(struct platform_device *pdev)
{
	struct virtio_wasm_device *vw_dev;
	int rc, device_id = 0;

	rc = of_property_read_u32(pdev->dev.of_node, "virtio-device-id",
				  &device_id);
	if (rc)
		return rc;

	vw_dev = kzalloc(sizeof(*vw_dev), GFP_KERNEL);
	if (!vw_dev)
		return -ENOMEM;

	vw_dev->pdev = pdev;
	vw_dev->vdev.dev.parent = &pdev->dev;
	vw_dev->vdev.dev.release = virtio_wasm_release_dev;
	vw_dev->vdev.config = &virtio_wasm_config_ops;
	vw_dev->vdev.id.device = device_id;
	vw_dev->vdev.id.vendor = VIRTIO_DEV_ANY_ID;
	vw_dev->config_irq = wasm_alloc_irq();

	if (vw_dev->config_irq < 0) {
		rc = vw_dev->config_irq;
		goto error;
	}

	rc = of_property_read_u32(pdev->dev.of_node, "host-id",
				  &vw_dev->host_id);
	if (rc)
		goto error_free_irq;

	rc = of_property_read_u64(pdev->dev.of_node, "features",
				  &vw_dev->features);
	if (rc)
		goto error_free_irq;

	vw_dev->config = kzalloc(vw_dev->config_len = 0x100, GFP_KERNEL);
	if (!vw_dev->config) {
		rc = -ENOMEM;
		goto error_free_irq;
	}

	rc = of_property_read_variable_u8_array(pdev->dev.of_node, "config",
						vw_dev->config, 0,
						vw_dev->config_len);
	if (rc < 0) {
		pr_warn("failed to read config from device tree\n");
		kfree(vw_dev->config);
		goto error_free_irq;
	}

	platform_set_drvdata(pdev, vw_dev);

	wasm_kernel_run_on_main(_setup, vw_dev);

	rc = register_virtio_device(&vw_dev->vdev);
	if (rc) {
		/* the release callback frees vw_dev */
		put_device(&vw_dev->vdev.dev);
		return rc;
	}

	return 0;
error_free_irq:
	wasm_free_irq(vw_dev->config_irq);
error:
	kfree(vw_dev);
	return rc;
}

static void virtio_wasm_remove(struct platform_device *pdev)
{
	struct virtio_wasm_device *vw_dev = platform_get_drvdata(pdev);
	int config_irq = vw_dev->config_irq;

	unregister_virtio_device(&vw_dev->vdev);
	wasm_free_irq(config_irq);
}

static const struct of_device_id virtio_wasm_match[] = {
	{
		.compatible = "virtio,wasm",
	},
	{},
};
MODULE_DEVICE_TABLE(of, virtio_wasm_match);

static struct platform_driver virtio_wasm_driver = {
	.probe		= virtio_wasm_probe,
	.remove_new	= virtio_wasm_remove,
	.driver		= {
		.name	= "virtio-wasm",
		.of_match_table	= virtio_wasm_match,
	},
};

module_platform_driver(virtio_wasm_driver);

MODULE_DESCRIPTION("Platform bus driver for WebAssembly virtio devices");
MODULE_LICENSE("GPL");
