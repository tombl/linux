#include <linux/printk.h>
#include <linux/irqchip.h>
#include <linux/seq_file.h>

void __init init_IRQ(void)
{
	irqchip_init();
}

int show_interrupts(struct seq_file *p, int prec)
{
	seq_printf(p, "nothing to see here\n");
	return 0;
}
