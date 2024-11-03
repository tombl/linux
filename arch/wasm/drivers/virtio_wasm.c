#define pr_fmt(fmt) "virtio-wasm: " fmt

#include <asm/wasm_imports.h>
#include <linux/device.h>
#include <linux/interrupt.h>
#include <linux/mod_devicetable.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/virtio_config.h>
#include <linux/virtio_ring.h>
#include <linux/virtio.h>

int wasm_import(virtio, get_features)(u32 id, u64 *features);
int wasm_import(virtio, set_features)(u32 id, u64 features);
int wasm_import(virtio, set_vring_enable)(u32 id, u32 index, bool enable);
int wasm_import(virtio, set_vring_num)(u32 id, u32 index, u32 num);
int wasm_import(virtio, set_vring_addr)(u32 id, u32 index, dma_addr_t desc,
					dma_addr_t used, dma_addr_t avail);
int wasm_import(virtio, set_interrupt_addrs)(u32 id, bool *is_config,
					     bool *is_vring);
int wasm_import(virtio, notify)(u32 id, u32 index);

#define to_virtio_wasm_device(_plat_dev) \
	container_of(_plat_dev, struct virtio_wasm_device, vdev)

struct virtio_wasm_device {
	struct virtio_device vdev;
	struct platform_device *pdev;
	int irq;

	u32 host_id;
	u8 status;
	u64 features;

	bool interrupt_is_config;
	bool interrupt_is_vring;
};

static bool vw_notify(struct virtqueue *vq)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vq->vdev);
	return wasm_virtio_notify(vw_dev->host_id, vq->index) == 0;
}

static u8 vw_get_status(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->status;
}
static void vw_set_status(struct virtio_device *vdev, u8 status)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	vw_dev->status = status;
}
static void vw_reset(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	vw_dev->status = 0;
}

static void vw_del_vqs(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	struct virtqueue *vq, *n;

	list_for_each_entry_safe(vq, n, &vdev->vqs, list) {
		vring_del_virtqueue(vq);
		WARN(wasm_virtio_set_vring_enable(vw_dev->host_id, vq->index,
						  false) < 0,
		     "failed to disable vq %i[%i]\n", vw_dev->host_id,
		     vq->index);
	}

	free_irq(vw_dev->irq, vw_dev);
	wasm_free_irq(vw_dev->irq);
}

static irqreturn_t vw_interrupt(int irq, void *dev)
{
	struct virtio_wasm_device *vw_dev = dev;
	unsigned long flags;
	irqreturn_t ret = IRQ_NONE;
	struct virtqueue *vq;

	if (unlikely(vw_dev->interrupt_is_config)) {
		virtio_config_changed(&vw_dev->vdev);
		ret = IRQ_HANDLED;
	}

	if (likely(vw_dev->interrupt_is_vring)) {
		spin_lock_irqsave(&vw_dev->vdev.vqs_list_lock, flags);

		list_for_each_entry(vq, &vw_dev->vdev.vqs, list)
			ret |= vring_interrupt(irq, vq);

		spin_unlock_irqrestore(&vw_dev->vdev.vqs_list_lock, flags);
	}

	return ret;
}

static struct virtqueue *vw_setup_vq(struct virtio_device *vdev, unsigned index,
				     vq_callback_t *callback, const char *name,
				     bool ctx)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	struct virtqueue *vq;
	int rc, num = 256;

	vq = vring_create_virtqueue(index, num, PAGE_SIZE, vdev, true, true,
				    ctx, vw_notify, callback, name);
	if (!vq)
		return ERR_PTR(-ENOMEM);
	vq->num_max = num;
	num = virtqueue_get_vring_size(vq);

	rc = wasm_virtio_set_vring_num(vw_dev->host_id, vq->index, num);
	if (rc)
		goto error;

	rc = wasm_virtio_set_vring_addr(vw_dev->host_id, vq->index,
					virtqueue_get_desc_addr(vq),
					virtqueue_get_used_addr(vq),
					virtqueue_get_avail_addr(vq));
	if (rc)
		goto error;

	rc = wasm_virtio_set_vring_enable(vw_dev->host_id, vq->index, true);
	if (rc)
		goto error;

	return vq;
error:
	vring_del_virtqueue(vq);
	return ERR_PTR(rc);
}

static int vw_find_vqs(struct virtio_device *vdev, unsigned nvqs,
		       struct virtqueue *vqs[], vq_callback_t *callbacks[],
		       const char *const names[], const bool *ctx,
		       struct irq_affinity *desc)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	int i, queue_idx = 0, rc;

	rc = request_irq(vw_dev->irq, vw_interrupt, IRQF_SHARED,
			 dev_name(&vdev->dev), vw_dev);
	if (rc)
		return rc;

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
	}

	return 0;
error:
	vw_del_vqs(vdev);
	return rc;
}

static u64 vw_get_features(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->features;
}
static int vw_finalize_features(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	vring_transport_features(vdev);
	return wasm_virtio_set_features(vw_dev->host_id, vdev->features);
}

static const char *vw_bus_name(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->pdev->name;
}

static const struct virtio_config_ops virtio_wasm_config_ops = {
	// .get = vw_get,
	// .set = vw_set,
	.get_status = vw_get_status,
	.set_status = vw_set_status,
	.reset = vw_reset,
	.find_vqs = vw_find_vqs,
	.del_vqs = vw_del_vqs,
	.get_features = vw_get_features,
	.finalize_features = vw_finalize_features,
	.bus_name = vw_bus_name,
};

static void virtio_wasm_release_dev(struct device *_d)
{
	struct virtio_device *vdev = dev_to_virtio(_d);
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	kfree(vw_dev);
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
	vw_dev->irq = wasm_alloc_irq();

	if (vw_dev->irq < 0) {
		rc = vw_dev->irq;
		goto error;
	}

	rc = of_property_read_u32(pdev->dev.of_node, "host-id",
				  &vw_dev->host_id);
	if (rc)
		goto error;

	rc = wasm_virtio_get_features(vw_dev->host_id, &vw_dev->features);
	if (rc)
		goto error;

	rc = wasm_virtio_set_interrupt_addrs(vw_dev->host_id,
					     &vw_dev->interrupt_is_config,
					     &vw_dev->interrupt_is_vring);
	if (rc)
		goto error;

	platform_set_drvdata(pdev, vw_dev);

	rc = register_virtio_device(&vw_dev->vdev);
	if (rc) {
		put_device(&vw_dev->vdev.dev);
		goto error;
	}

	return 0;
error:
	kfree(vw_dev);
	return rc;
}

static void virtio_wasm_remove(struct platform_device *pdev)
{
	struct virtio_wasm_device *vw_dev = platform_get_drvdata(pdev);
	unregister_virtio_device(&vw_dev->vdev);
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
