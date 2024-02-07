#include "linux/compiler_attributes.h"
#include "linux/printk.h"
#include <asm/wasm_imports.h>
#include <linux/kernel.h>
#include <linux/console.h>
#include <linux/init.h>

static void early_console_write(struct console *con, const char *s,
				unsigned int n)
{
	wasm_print(s, n);
}

static struct console early_console_dev = {
	.name = "earlycon",
	.write = early_console_write,
	.flags = CON_BOOT,
	.index = -1,
};

int __init setup_early_printk(char *buf)
{
	early_console = &early_console_dev;
	register_console(&early_console_dev);
	return 0;
}

early_param("earlyprintk", setup_early_printk);
