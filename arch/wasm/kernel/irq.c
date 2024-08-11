#include <asm/smp.h>
#include <linux/bitops.h>
#include <linux/hardirq.h>
#include <linux/init.h>
#include <linux/irq.h>
#include <linux/irqchip.h>
#include <linux/irqdomain.h>
#include <linux/processor.h>

static DEFINE_PER_CPU(unsigned long, irqflags);
static DEFINE_PER_CPU(unsigned long, irq_status[NR_IRQS / BITS_PER_LONG]);

static void run_irq(irq_hw_number_t hwirq)
{
	static struct pt_regs dummy;
	unsigned long flags;
	struct pt_regs *old_regs = set_irq_regs((struct pt_regs *)&dummy);

	/* interrupt handlers need to run with interrupts disabled */
	local_irq_save(flags);
	irq_enter();
	generic_handle_domain_irq(NULL, hwirq);
	irq_exit();
	set_irq_regs(old_regs);
	local_irq_restore(flags);
}

unsigned long arch_local_save_flags(void)
{
	return __this_cpu_read(irqflags);
}

static void run_irqs(void)
{
	int irq;
	unsigned long(*status)[NR_IRQS / BITS_PER_LONG] =
		this_cpu_ptr(&irq_status);

	for_each_irq_nr(irq)
		if (test_and_clear_bit(irq % BITS_PER_LONG,
				       status[irq / BITS_PER_LONG]))
			run_irq(irq);
}

__attribute__((export_name("trigger_irq"))) void trigger_irq(unsigned int irq)
{
	unsigned long(*status)[NR_IRQS / BITS_PER_LONG] =
		this_cpu_ptr(&irq_status);

	if (arch_irqs_disabled()) {
		set_bit(irq % BITS_PER_LONG, status[irq / BITS_PER_LONG]);
		return;
	}

	run_irq(irq);
}

void trigger_irq_for_cpu(unsigned int cpu, unsigned int irq)
{
	unsigned long(*status)[NR_IRQS / BITS_PER_LONG] =
		per_cpu_ptr(&irq_status, cpu);

	set_bit(irq % BITS_PER_LONG, status[irq / BITS_PER_LONG]);
}

void arch_local_irq_restore(unsigned long flags)
{
	if (flags == ARCH_IRQ_ENABLED && arch_irqs_disabled() &&
	    !in_interrupt())
		run_irqs();
	__this_cpu_write(irqflags, flags);
}

void __init init_IRQ(void)
{
	// int irq;

	irqchip_init();

	// for_each_irq_nr(irq)
	// 	irq_set_chip_and_handler(irq, &dummy_irq_chip,
	// 				 handle_simple_irq);

#ifdef CONFIG_SMP
	setup_smp_ipi();
#endif

	pr_info("IRQs enabled\n");
}

void cpu_yield_to_irqs(void)
{
	cpu_relax();
}
