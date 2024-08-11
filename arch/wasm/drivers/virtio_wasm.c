#define pr_fmt(fmt) "virtio-wasm: " fmt

#include <linux/platform_device.h>
#include <linux/module.h>
#include <linux/mod_devicetable.h>
#include <linux/virtio.h>
#include <linux/virtio_config.h>

#define to_virtio_wasm_device(_plat_dev) \
	container_of(_plat_dev, struct virtio_wasm_device, vdev)

struct virtio_wasm_device {
	struct virtio_device vdev;
	struct platform_device *pdev;
};

static void vw_get_config(struct virtio_device *vdev, unsigned int offset, void *buf,
		   unsigned int len)
{
	struct virtio_wasm_device *vw_dev = to_virtio_wasm_device(vdev);
        
}

static const struct virtio_config_ops virtio_config_ops = {
	.get = vw_get_config,
	// .set = vw_set,
	// .generation = vw_generation,
	// .get_status = vw_get_status,
	// .set_status = vw_set_status,
	// .reset = vw_reset,
	// .find_vqs = vw_find_vqs,
	// .del_vqs = vw_del_vqs,
	// .get_features = vw_get_features,
	// .finalize_features = vw_finalize_features,
	// .bus_name = vw_bus_name,
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

	vw_dev->vdev.dev.parent = &pdev->dev;
	vw_dev->vdev.dev.release = release_dev;
	vw_dev->vdev.config = &virtio_config_ops;
	vw_dev->pdev = pdev;

	ret = register_virtio_device(&vw_dev->vdev);
	if (ret)
		put_device(&vw_dev->vdev.dev);

	return ret;
}

static void remove(struct platform_device *pdev)
{
}

static struct platform_driver platform_driver = {
	.probe = probe,
	.remove_new = remove,
	.driver.name = KBUILD_MODNAME,
	.driver.owner = THIS_MODULE,
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
