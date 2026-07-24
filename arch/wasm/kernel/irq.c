#include <asm/smp.h>
#include <asm/timex.h>
#include <linux/cpu.h>
#include <linux/bitops.h>
#include <linux/hardirq.h>
#include <linux/init.h>
#include <linux/irq.h>
#include <linux/irqchip.h>
#include <linux/irqdomain.h>
#include <linux/processor.h>

/*
 * Two-level pending bitmap. A wasm atomic wait can only watch a single
 * address, so idle waits on the summary word; bit w of the summary means
 * words[w] has pending irqs.
 */
struct pending_irqs {
	atomic64_t summary;
	atomic64_t words[NR_IRQS / 64];
};

static DEFINE_PER_CPU(unsigned long, irqflags);
static DEFINE_PER_CPU(struct pending_irqs, irq_pending);
static DEFINE_PER_CPU(u64, timer_deadline_ns);

/* delivery target per hwirq, maintained by wasm_irq_set_affinity */
static u32 irq_target[NR_IRQS];

/* set the pending bit, then the summary bit: consumers read in reverse */
static void pend_irq(struct pending_irqs *pending, irq_hw_number_t irq)
{
	atomic64_or(BIT_ULL(irq % 64), &pending->words[irq / 64]);
	atomic64_or(BIT_ULL(irq / 64), &pending->summary);
}

void wasm_set_timer_deadline(u64 deadline_ns)
{
	__this_cpu_write(timer_deadline_ns, deadline_ns);
}

u64 wasm_get_timer_deadline(void)
{
	return __this_cpu_read(timer_deadline_ns);
}

void __cpuidle arch_cpu_idle(void)
{
	struct pending_irqs *pending = this_cpu_ptr(&irq_pending);
	u64 deadline = __this_cpu_read(timer_deadline_ns);
	u64 now;
	s64 timeout_ns;
	int ret;

	if (deadline == 0) {
		timeout_ns = -1; // forever
	} else {
		now = wasm_kernel_get_now_nsec();
		if ((s64)(deadline - now) <= 0) {
			__this_cpu_write(timer_deadline_ns, 0);
			pend_irq(pending, TIMER_IRQ);
			raw_local_irq_enable();
			return;
		}
		timeout_ns = deadline - now;
	}

	ret = __builtin_wasm_memory_atomic_wait64(&pending->summary.counter, 0,
						  timeout_ns);

	if (ret == 2 /* timeout reached */) {
		__this_cpu_write(timer_deadline_ns, 0);
		pend_irq(pending, TIMER_IRQ);
	}

	raw_local_irq_enable();
}

/*
 * A running task never enters arch_cpu_idle, so the per-cpu deadline armed by
 * the clockevent's set_next_event would only be noticed once the cpu next goes
 * idle. That starves timers for a busy task: setitimer()/alarm() and per-process
 * posix timers program an hrtimer whose expiry raises SIGALRM, but with nothing
 * polling the deadline the hrtimer never fires while the task keeps running (or
 * spins in a tight syscall loop), so the signal is never delivered.
 *
 * Poll the deadline on every entry to the kernel from user mode. An expired
 * deadline raises TIMER_IRQ; restoring the (enabled) irq state then runs
 * hrtimer_interrupt, which expires the timer and makes the signal pending so it
 * is delivered on the way back to user space. Cooperative-only: a task that
 * never re-enters the kernel still cannot be preempted.
 */
void wasm_timer_check(void)
{
	unsigned long flags;
	u64 deadline;

	local_irq_save(flags);
	deadline = __this_cpu_read(timer_deadline_ns);
	if (deadline &&
	    (s64)(wasm_kernel_get_now_nsec() - deadline) >= 0) {
		__this_cpu_write(timer_deadline_ns, 0);
		pend_irq(this_cpu_ptr(&irq_pending), TIMER_IRQ);
	}
	local_irq_restore(flags);
}

void cpu_relax(void)
{
	unsigned long flags;
	struct pending_irqs *pending;
	local_irq_save(flags);
	pending = this_cpu_ptr(&irq_pending);
	__builtin_wasm_memory_atomic_wait64(&pending->summary.counter, 0,
					    10 * 1000 * 1000);
	local_irq_restore(flags);
}

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
	struct pending_irqs *p = this_cpu_ptr(&irq_pending);
	u64 summary = atomic64_xchg(&p->summary, 0);

	while (summary) {
		int word = __ffs64(summary);
		u64 pending = atomic64_xchg(&p->words[word], 0);

		summary &= summary - 1;

		while (pending) {
			int bit = __ffs64(pending);

			pending &= pending - 1;
			run_irq(word * 64 + bit);
		}
	}
}

__attribute__((export_name("trigger_irq_for_cpu"))) void
trigger_irq_for_cpu(unsigned int cpu, irq_hw_number_t irq)
{
	struct pending_irqs *pending = per_cpu_ptr(&irq_pending, cpu);

	pend_irq(pending, irq);

	__builtin_wasm_memory_atomic_notify((void *)&pending->summary.counter,
					    /* at most, wake up: */ 1);
}

__attribute__((export_name("trigger_irq"))) void
trigger_irq(irq_hw_number_t irq)
{
	trigger_irq_for_cpu(READ_ONCE(irq_target[irq]), irq);
}

void arch_local_irq_restore(unsigned long flags)
{
	if (flags == ARCH_IRQ_ENABLED && !in_interrupt())
		run_irqs();
	__this_cpu_write(irqflags, flags);
}

#ifdef CONFIG_SMP
static int wasm_irq_set_affinity(struct irq_data *data,
				 const struct cpumask *dest, bool force)
{
	unsigned int cpu;

	if (force)
		cpu = cpumask_first_and(dest, cpu_online_mask);
	else
		cpu = cpumask_any_and_distribute(dest, cpu_online_mask);

	if (cpu >= nr_cpu_ids)
		return -EINVAL;

	WRITE_ONCE(irq_target[data->hwirq], cpu);
	irq_data_update_effective_affinity(data, cpumask_of(cpu));

	return IRQ_SET_MASK_OK;
}
#endif

static void wasm_irq_noop(struct irq_data *data)
{
}

static int wasm_irq_retrigger(struct irq_data *data)
{
	trigger_irq(data->hwirq);
	return 1;
}

static struct irq_chip wasm_irq_chip = {
	.name = "wasm",
	/* pending bits are latched per-cpu; there is nothing to ack or mask */
	.irq_ack = wasm_irq_noop,
	.irq_mask = wasm_irq_noop,
	.irq_unmask = wasm_irq_noop,
	.irq_retrigger = wasm_irq_retrigger,
#ifdef CONFIG_SMP
	.irq_set_affinity = wasm_irq_set_affinity,
#endif
};

static int wasm_irq_map(struct irq_domain *d, unsigned int irq,
			irq_hw_number_t hw)
{
	if (hw < FIRST_EXT_IRQ) {
		/* IPI and timer fire on the cpu that handles them */
		irq_set_chip_and_handler(irq, &dummy_irq_chip,
					 handle_percpu_irq);
	} else {
		irq_set_chip_and_handler(irq, &wasm_irq_chip, handle_edge_irq);
	}

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

	irq_set_default_domain(root_domain);

#ifdef CONFIG_SMP
	irq_create_mapping(root_domain, IPI_IRQ);
	setup_smp_ipi();
#endif

	pr_info("IRQs enabled\n");
}

static DECLARE_BITMAP(irqalloc, NR_IRQS);
// TODO: wrap request_irq and free_irq instead expecting the caller to call these then them
int wasm_alloc_irq(void)
{
	for (int i = FIRST_EXT_IRQ; i < NR_IRQS; i++) {
		if (!test_and_set_bit(i, irqalloc))
			return irq_create_mapping(NULL, i);
	}
	return -ENOSPC;
}
void wasm_free_irq(int irq)
{
	WARN(!test_and_clear_bit(irq, irqalloc),
	     "irq %d not allocated. double free?\n", irq);
}
