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

__attribute__((export_name("trigger_irq"))) void trigger_irq(irq_hw_number_t irq)
{
	unsigned long(*status)[NR_IRQS / BITS_PER_LONG] =
		this_cpu_ptr(&irq_status);

	if (arch_irqs_disabled()) {
		set_bit(irq % BITS_PER_LONG, status[irq / BITS_PER_LONG]);
		return;
	}

	run_irq(irq);
}

void trigger_irq_for_cpu(unsigned int cpu, irq_hw_number_t irq)
{
	unsigned long(*status)[NR_IRQS / BITS_PER_LONG] =
		per_cpu_ptr(&irq_status, cpu);

	pr_info("trigger irq %lu for cpu %d\n", irq, cpu);

	set_bit(irq % BITS_PER_LONG, status[irq / BITS_PER_LONG]);
}

void arch_local_irq_restore(unsigned long flags)
{
	if (flags == ARCH_IRQ_ENABLED && arch_irqs_disabled() &&
	    !in_interrupt())
		run_irqs();
	__this_cpu_write(irqflags, flags);
}

static int wasm_irq_map(struct irq_domain *d, unsigned int irq,
			irq_hw_number_t hw)
{
	pr_info("wasm_irq_map: %d -> %lu\n", irq, hw);

	// if (hw < FIRST_EXT_IRQ) {
	// 	irq_set_percpu_devid(irq);
	// 	irq_set_chip_and_handler(irq, &dummy_irq_chip, handle_percpu_irq);
	// } else {
	irq_set_chip_and_handler(irq, &dummy_irq_chip, handle_simple_irq);
	// }

	return 0;
}

static const struct irq_domain_ops wasm_irq_ops = {
	.xlate = irq_domain_xlate_onecell,
	.map = wasm_irq_map,
};

void __init init_IRQ(void)
{
	struct irq_domain *root_domain;

        pr_info("init wasm irq\n");

        root_domain = irq_domain_add_linear(NULL, NR_IRQS, &wasm_irq_ops, NULL);
        if (!root_domain)
                panic("root irq domain not available\n");

        irq_set_default_host(root_domain);

#ifdef CONFIG_SMP
        irq_create_mapping(root_domain, IPI_IRQ);
	setup_smp_ipi();
#endif

	pr_info("IRQs enabled\n");
}

void cpu_yield_to_irqs(void)
{
	cpu_relax();
}
