#define pr_fmt(fmt) "virtio-wasm: " fmt

#include <asm/wasm_imports.h>
#include <linux/interrupt.h>
#include <linux/irqreturn.h>
#include <linux/mod_devicetable.h>
#include <linux/module.h>
#include <linux/of.h>
#include <linux/platform_device.h>
#include <linux/virtio_config.h>
#include <linux/virtio_ring.h>
#include <linux/virtio.h>

int wasm_import(virtio, init)(u32 device_id, u32 kind);
void wasm_import(virtio, remove)(u32 device_id);

void wasm_import(virtio, get_config)(u32 device_id, unsigned offset, void *buf,
				     unsigned len);
void wasm_import(virtio, set_config)(u32 device_id, unsigned offset,
				     const void *buf, unsigned len);
u32 wasm_import(virtio, config_generation)(u32 device_id);
u8 wasm_import(virtio, get_status)(u32 device_id);
void wasm_import(virtio, set_status)(u32 device_id, u8 status);
void wasm_import(virtio, reset)(u32 device_id);
void wasm_import(virtio, vring_init)(u32 device_id, u32 index, u32 num,
				     u32 desc, u32 avail, u32 used);
void wasm_import(virtio, del_vqs)(u32 device_id);
u64 wasm_import(virtio, get_features)(u32 device_id);
int wasm_import(virtio, finalize_features)(u32 device_id);

struct virtio_wasm_device {
	struct virtio_device vdev;
	struct platform_device *pdev;
	u32 device_id;
};

static inline struct virtio_wasm_device *
to_virtio_wasm_device(struct virtio_device *vdev)
{
	return container_of(vdev, struct virtio_wasm_device, vdev);
}

static void vw_get_config(struct virtio_device *vdev, unsigned offset,
			  void *buf, unsigned len)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	wasm_virtio_get_config(vw_dev->device_id, offset, buf, len);
}

static void vw_set_config(struct virtio_device *vdev, unsigned offset,
			  const void *buf, unsigned len)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	wasm_virtio_set_config(vw_dev->device_id, offset, buf, len);
}

static u32 vw_config_generation(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return wasm_virtio_config_generation(vw_dev->device_id);
}

static u8 vw_get_status(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return wasm_virtio_get_status(vw_dev->device_id);
}

static void vw_set_status(struct virtio_device *vdev, u8 status)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	wasm_virtio_set_status(vw_dev->device_id, status);
}

static void vw_reset(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	wasm_virtio_reset(vw_dev->device_id);
}

static void vw_del_vqs(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	wasm_virtio_del_vqs(vw_dev->device_id);
}

static irqreturn_t vw_interrupt(int irq, void *opaque)
{
	struct virtio_wasm_device *vw_dev = opaque;

	pr_info("vw_interrupt(%d) for %s\n", irq, dev_name(&vw_dev->vdev.dev));

	return IRQ_NONE;
}

static bool vw_notify(struct virtqueue *vq)
{
	pr_info("vw_notify for %s\n", vq->name);
	return false;
}

static struct virtqueue *vw_setup_vq(struct virtio_device *vdev,
				     unsigned int index,
				     void (*callback)(struct virtqueue *vq),
				     const char *name, bool ctx)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	struct virtqueue *vq;
	int err;

	vq = vring_create_virtqueue(index, 256, PAGE_SIZE, vdev, true, true,
				    ctx, vw_notify, callback, name);
	if (!vq) {
		err = -ENOMEM;
		goto error;
	}

	wasm_virtio_vring_init(vw_dev->device_id, index,
			       virtqueue_get_vring_size(vq),
			       virtqueue_get_desc_addr(vq),
			       virtqueue_get_avail_addr(vq),
			       virtqueue_get_used_addr(vq));

	return vq;
error:
	return ERR_PTR(err);
};

static int vw_find_vqs(struct virtio_device *vdev, unsigned nvqs,
		       struct virtqueue *vqs[], vq_callback_t *callbacks[],
		       const char *const names[], const bool *ctx,
		       struct irq_affinity *desc)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	int irq = platform_get_irq(vw_dev->pdev, 0);
	int i, err, queue_idx = 0;

	if (irq < 0)
		return irq;

	err = request_irq(irq, vw_interrupt, IRQF_SHARED, dev_name(&vdev->dev),
			  vw_dev);
	if (err)
		return err;

	for (i = 0; i < nvqs; ++i) {
		if (!names[i]) {
			vqs[i] = NULL;
			continue;
		}

		vqs[i] = vw_setup_vq(vdev, queue_idx++, callbacks[i], names[i],
				     ctx ? ctx[i] : false);
		if (IS_ERR(vqs[i])) {
			vw_del_vqs(vdev);
			return PTR_ERR(vqs[i]);
		}
	}

	return 0;
};

static u64 vw_get_features(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return wasm_virtio_get_features(vw_dev->device_id);
}

static int vw_finalize_features(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return wasm_virtio_finalize_features(vw_dev->device_id);
}

static const char *vw_bus_name(struct virtio_device *vdev)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
	return vw_dev->pdev->name;
}

static const struct virtio_config_ops virtio_config_ops = {
	.get = vw_get_config,
	.set = vw_set_config,
	.generation = vw_config_generation,
	.get_status = vw_get_status,
	.set_status = vw_set_status,
	.reset = vw_reset,
	.find_vqs = vw_find_vqs,
	.del_vqs = vw_del_vqs,
	.get_features = vw_get_features,
	.finalize_features = vw_finalize_features,
	.bus_name = vw_bus_name,
	// .get_shm_region = vw_get_shm_region,
	// .synchronize_cbs = vw_synchronize_cbs,
};

static void release_dev(struct device *_d)
{
	struct virtio_device *vdev =
		container_of(_d, struct virtio_device, dev);
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);

	kfree(vw_dev);
}

static int probe(struct platform_device *pdev)
{
	struct virtio_wasm_device *vw_dev;
	int ret;

	vw_dev = kzalloc(sizeof(*vw_dev), GFP_KERNEL);
	if (!vw_dev)
		return -ENOMEM;

	pr_info("found device: %s\n", pdev->dev.of_node->full_name);

	vw_dev->vdev.dev.parent = &pdev->dev;
	vw_dev->vdev.dev.release = release_dev;
	vw_dev->vdev.config = &virtio_config_ops;
	vw_dev->vdev.id.vendor = VIRTIO_DEV_ANY_ID;
	vw_dev->pdev = pdev;
	pdev->dev.platform_data = vw_dev;

	ret = of_property_read_u32(pdev->dev.of_node, "host-id",
				   &vw_dev->device_id);
	if (ret < 0)
		return ret;

	ret = of_property_read_u32(pdev->dev.of_node, "virtio-id",
				   &vw_dev->vdev.id.device);
	if (ret < 0)
		return ret;

	ret = wasm_virtio_init(vw_dev->device_id, vw_dev->vdev.id.device);
	if (ret)
		return ret;

	ret = register_virtio_device(&vw_dev->vdev);
	if (ret)
		put_device(&vw_dev->vdev.dev);

	return ret;
}

static const struct of_device_id virtio_wasm_match[] = {
	{ .compatible = "virtio,wasm" },
	{},
};
MODULE_DEVICE_TABLE(of, virtio_wasm_match);

static struct platform_driver platform_driver = {
	.probe = probe,
	.driver = { 
		.name = KBUILD_MODNAME,
		.owner = THIS_MODULE,
		.of_match_table = virtio_wasm_match,
	},
};

static int __init init(void)
{
	return platform_driver_register(&platform_driver);
}

static void exit(void)
{
	platform_driver_unregister(&platform_driver);
}

module_init(init);
module_exit(exit);

MODULE_DESCRIPTION("WebAssembly driver for virtio devices");
MODULE_LICENSE("GPL");
