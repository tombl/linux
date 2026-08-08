/* Write a gradient to /dev/fb0. Proves the canvas presenter path. */
#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

int main(void)
{
	int fd = open("/dev/fb0", O_RDWR);
	struct fb_var_screeninfo vinfo;
	struct fb_fix_screeninfo finfo;
	size_t size;
	uint8_t *buf;
	uint32_t x, y;

	if (fd < 0) {
		perror("open /dev/fb0");
		return 1;
	}
	memset(&vinfo, 0, sizeof(vinfo));
	memset(&finfo, 0, sizeof(finfo));
	if (ioctl(fd, FBIOGET_VSCREENINFO, &vinfo) < 0 ||
	    ioctl(fd, FBIOGET_FSCREENINFO, &finfo) < 0) {
		perror("fb ioctl");
		return 1;
	}
	printf("fb %ux%u-%u stride=%u\n", vinfo.xres, vinfo.yres,
	       vinfo.bits_per_pixel, finfo.line_length);
	size = (size_t)finfo.line_length * vinfo.yres;
	buf = malloc(size);
	if (!buf)
		return 1;
	for (y = 0; y < vinfo.yres; y++) {
		for (x = 0; x < vinfo.xres; x++) {
			uint8_t *p = buf + (size_t)y * finfo.line_length +
				     (size_t)x * 4;
			p[0] = (uint8_t)(x * 255 / (vinfo.xres ? vinfo.xres : 1));
			p[1] = (uint8_t)(y * 255 / (vinfo.yres ? vinfo.yres : 1));
			p[2] = 64;
			p[3] = 255;
		}
	}
	if (pwrite(fd, buf, size, 0) < 0) {
		perror("pwrite");
		return 1;
	}
	printf("FBTEST_OK\n");
	fflush(stdout);
	for (;;)
		pause();
}
