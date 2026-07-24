#include <asm/wasm_imports.h>
#include <linux/console.h>
#include <linux/init.h>
#include <linux/kernel.h>
#include <linux/printk.h>

static void early_console_write(struct console *con, const char *s,
				unsigned int n)
{
	wasm_kernel_boot_console_write(s, n);
}

static int early_console_exit(struct console *con)
{
	wasm_kernel_boot_console_close();
	return 0;
}

static struct console early_console_dev = {
	.name = "earlycon",
	.write = early_console_write,
	.exit = early_console_exit,
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
