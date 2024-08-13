#define pr_fmt(fmt) "wasm/irq: " fmt

#include <asm/smp.h>
#include <linux/cpu.h>
#include <linux/bitops.h>
#include <linux/hardirq.h>
#include <linux/init.h>
#include <linux/irq.h>
#include <linux/irqchip.h>
#include <linux/irqdomain.h>
#include <linux/processor.h>

static DEFINE_PER_CPU(unsigned long, irqflags);
static DEFINE_PER_CPU(atomic64_t, irq_pending);

void __cpuidle arch_cpu_idle(void)
{
	atomic64_t *pending = this_cpu_ptr(&irq_pending);
	pr_info("%i idle\n", raw_smp_processor_id());
	__builtin_wasm_memory_atomic_wait64(&pending->counter, 0, -1);
	pr_info("%i wake\n", raw_smp_processor_id());
	raw_local_irq_enable();
}

void cpu_relax(void)
{
	// static bool dumping = false;
	unsigned long flags;
	atomic64_t *pending;
	local_irq_save(flags);
	pending = this_cpu_ptr(&irq_pending);
	// pr_info("%i relax: %llx\n", raw_smp_processor_id(), pending->counter);
	// if (!dumping) {
	// 	dumping = true;
	// 	dump_stack();
	// 	dumping = false;
	// }
	__builtin_wasm_memory_atomic_wait64(&pending->counter, 0,
					    10 * 1000 * 1000);
	local_irq_restore(flags);
}

static void run_irq(irq_hw_number_t hwirq)
{
	static struct pt_regs dummy;
	unsigned long flags;
	struct pt_regs *old_regs = set_irq_regs((struct pt_regs *)&dummy);

	pr_info("%i: handling\n", raw_smp_processor_id());

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
	atomic64_t *pending = this_cpu_ptr(&irq_pending);

	for_each_irq_nr(irq)
		if (atomic64_fetch_andnot(1 << irq, pending) & (1 << irq))
			run_irq(irq);
}

// __attribute__((export_name("trigger_irq"))) void
// trigger_irq(irq_hw_number_t irq)
// {
// 	unsigned long(*pending)[NR_IRQS / BITS_PER_LONG] =
// 		this_cpu_ptr(&irq_pending);

// 	if (arch_irqs_disabled()) {
// 		set_bit(irq % BITS_PER_LONG, pending[irq / BITS_PER_LONG]);
// 		return;
// 	}

// 	run_irq(irq);
// }

__attribute__((export_name("trigger_irq_for_cpu"))) void
trigger_irq_for_cpu(unsigned int cpu, irq_hw_number_t irq)
{
	atomic64_t *pending = per_cpu_ptr(&irq_pending, cpu);

	atomic64_fetch_or(1 << irq, pending);

	pr_info("%i: triggering %i\n", raw_smp_processor_id(), cpu);

	__builtin_wasm_memory_atomic_notify((void *)&pending->counter,
					    /* at most, wake up: */ 1);
}

void arch_local_irq_restore(unsigned long flags)
{
	if (flags == ARCH_IRQ_ENABLED && !in_interrupt())
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
