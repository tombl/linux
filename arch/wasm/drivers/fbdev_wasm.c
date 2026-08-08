// SPDX-License-Identifier: GPL-2.0-only
/*
 * WebAssembly canvas framebuffer: system-RAM /dev/fb0 presented to the host.
 *
 * Userspace draws with read/write (no mmap). After each write the driver asks
 * the host to copy the buffer onto a browser canvas.
 */

#include <asm/wasm_imports.h>
#include <linux/fb.h>
#include <linux/init.h>
#include <linux/kernel.h>
#include <linux/module.h>
#include <linux/platform_device.h>
#include <linux/slab.h>
#include <linux/vmalloc.h>

#define WASM_FB_WIDTH	1024
#define WASM_FB_HEIGHT	768
#define WASM_FB_BPP	32

struct wasm_fb {
	struct fb_info *info;
	void *memory;
	u32 width;
	u32 height;
	u32 bpp;
	bool present_pending;
	u32 palette[16];
};

static inline u32 wasm_fb_stride(u32 width, u32 bpp)
{
	return width * ((bpp + 7) / 8);
}

static inline u32 wasm_fb_size(u32 width, u32 height, u32 bpp)
{
	return wasm_fb_stride(width, bpp) * height;
}

static void wasm_fb_do_present(void *arg)
{
	struct wasm_fb *fb = arg;
	struct fb_info *info = fb->info;

	fb->present_pending = false;
	if (!info || !info->screen_buffer)
		return;

	wasm_fb_present(info->screen_buffer, fb->width, fb->height,
			info->fix.line_length, fb->bpp);
}

static void wasm_fb_schedule_present(struct wasm_fb *fb)
{
	if (fb->present_pending)
		return;
	fb->present_pending = true;
	wasm_kernel_run_on_main(wasm_fb_do_present, fb);
}

static int wasm_fb_check_var(struct fb_var_screeninfo *var,
			     struct fb_info *info)
{
	struct wasm_fb *fb = info->par;

	if (var->bits_per_pixel != fb->bpp ||
	    var->xres != fb->width ||
	    var->yres != fb->height ||
	    var->xres_virtual != fb->width ||
	    var->yres_virtual != fb->height)
		return -EINVAL;

	var->red.offset = 16;
	var->red.length = 8;
	var->green.offset = 8;
	var->green.length = 8;
	var->blue.offset = 0;
	var->blue.length = 8;
	var->transp.offset = 24;
	var->transp.length = 8;
	var->xoffset = 0;
	var->yoffset = 0;
	var->vmode = FB_VMODE_NONINTERLACED;
	return 0;
}

static int wasm_fb_set_par(struct fb_info *info)
{
	struct wasm_fb *fb = info->par;

	info->fix.line_length = wasm_fb_stride(fb->width, fb->bpp);
	info->fix.visual = FB_VISUAL_TRUECOLOR;
	info->fix.type = FB_TYPE_PACKED_PIXELS;
	return 0;
}

static int wasm_fb_setcolreg(unsigned regno, unsigned red, unsigned green,
			     unsigned blue, unsigned transp,
			     struct fb_info *info)
{
	u32 *pal = info->pseudo_palette;

	if (regno >= 16)
		return 1;

	pal[regno] = ((red >> 8) << info->var.red.offset) |
		     ((green >> 8) << info->var.green.offset) |
		     ((blue >> 8) << info->var.blue.offset) |
		     ((transp >> 8) << info->var.transp.offset);
	return 0;
}

static ssize_t wasm_fb_write(struct fb_info *info, const char __user *buf,
			     size_t count, loff_t *ppos)
{
	ssize_t ret = fb_sys_write(info, buf, count, ppos);

	if (ret > 0)
		wasm_fb_schedule_present(info->par);
	return ret;
}

static void wasm_fb_fillrect(struct fb_info *info,
			     const struct fb_fillrect *rect)
{
	sys_fillrect(info, rect);
	wasm_fb_schedule_present(info->par);
}

static void wasm_fb_copyarea(struct fb_info *info,
			     const struct fb_copyarea *area)
{
	sys_copyarea(info, area);
	wasm_fb_schedule_present(info->par);
}

static void wasm_fb_imageblit(struct fb_info *info,
			      const struct fb_image *image)
{
	sys_imageblit(info, image);
	wasm_fb_schedule_present(info->par);
}

static const struct fb_ops wasm_fb_ops = {
	.owner		= THIS_MODULE,
	.fb_read	= fb_sys_read,
	.fb_write	= wasm_fb_write,
	.fb_check_var	= wasm_fb_check_var,
	.fb_set_par	= wasm_fb_set_par,
	.fb_setcolreg	= wasm_fb_setcolreg,
	.fb_fillrect	= wasm_fb_fillrect,
	.fb_copyarea	= wasm_fb_copyarea,
	.fb_imageblit	= wasm_fb_imageblit,
};

static int wasm_fb_probe(struct platform_device *pdev)
{
	struct wasm_fb *fb;
	struct fb_info *info;
	void *memory;
	u32 width = WASM_FB_WIDTH;
	u32 height = WASM_FB_HEIGHT;
	u32 bpp = WASM_FB_BPP;
	u32 size;
	int ret;

	wasm_fb_get_mode(&width, &height, &bpp);
	if (!width || !height || bpp != 32)
		return -EINVAL;

	size = wasm_fb_size(width, height, bpp);
	memory = vzalloc(size);
	if (!memory)
		return -ENOMEM;

	info = framebuffer_alloc(sizeof(*fb), &pdev->dev);
	if (!info) {
		vfree(memory);
		return -ENOMEM;
	}

	fb = info->par;
	memset(fb, 0, sizeof(*fb));
	fb->info = info;
	fb->memory = memory;
	fb->width = width;
	fb->height = height;
	fb->bpp = bpp;

	info->fbops = &wasm_fb_ops;
	info->flags = FBINFO_VIRTFB;
	info->screen_buffer = memory;
	info->pseudo_palette = fb->palette;

	info->fix.smem_start = (unsigned long)memory;
	info->fix.smem_len = size;
	info->fix.id[0] = 'w';
	info->fix.id[1] = 'a';
	info->fix.id[2] = 's';
	info->fix.id[3] = 'm';
	info->fix.id[4] = '-';
	info->fix.id[5] = 'f';
	info->fix.id[6] = 'b';
	info->fix.id[7] = 0;
	info->fix.type = FB_TYPE_PACKED_PIXELS;
	info->fix.visual = FB_VISUAL_TRUECOLOR;
	info->fix.line_length = wasm_fb_stride(width, bpp);

	info->var.xres = width;
	info->var.yres = height;
	info->var.xres_virtual = width;
	info->var.yres_virtual = height;
	info->var.bits_per_pixel = bpp;
	info->var.activate = FB_ACTIVATE_NOW;
	info->var.height = -1;
	info->var.width = -1;
	info->var.vmode = FB_VMODE_NONINTERLACED;
	info->var.red.offset = 16;
	info->var.red.length = 8;
	info->var.green.offset = 8;
	info->var.green.length = 8;
	info->var.blue.offset = 0;
	info->var.blue.length = 8;
	info->var.transp.offset = 24;
	info->var.transp.length = 8;

	ret = fb_alloc_cmap(&info->cmap, 256, 0);
	if (ret)
		goto err_info;

	ret = register_framebuffer(info);
	if (ret)
		goto err_cmap;

	platform_set_drvdata(pdev, info);
	wasm_fb_schedule_present(fb);
	fb_info(info, "wasm framebuffer %ux%u-%u at %p\n",
		width, height, bpp, fb->memory);
	return 0;

err_cmap:
	fb_dealloc_cmap(&info->cmap);
err_info:
	framebuffer_release(info);
	vfree(memory);
	return ret;
}

static void wasm_fb_remove(struct platform_device *pdev)
{
	struct fb_info *info = platform_get_drvdata(pdev);
	struct wasm_fb *fb = info->par;
	void *memory = fb->memory;

	unregister_framebuffer(info);
	fb_dealloc_cmap(&info->cmap);
	framebuffer_release(info);
	vfree(memory);
}

static struct platform_driver wasm_fb_driver = {
	.probe = wasm_fb_probe,
	.remove = wasm_fb_remove,
	.driver = {
		.name = "wasm-fb",
	},
};

static struct platform_device *wasm_fb_device;

static int __init wasm_fb_init(void)
{
	int ret;

	ret = platform_driver_register(&wasm_fb_driver);
	if (ret)
		return ret;

	wasm_fb_device = platform_device_alloc("wasm-fb", 0);
	if (!wasm_fb_device) {
		platform_driver_unregister(&wasm_fb_driver);
		return -ENOMEM;
	}

	ret = platform_device_add(wasm_fb_device);
	if (ret) {
		platform_device_put(wasm_fb_device);
		platform_driver_unregister(&wasm_fb_driver);
		wasm_fb_device = NULL;
	}
	return ret;
}

device_initcall(wasm_fb_init);
