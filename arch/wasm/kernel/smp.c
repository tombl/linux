#include <asm/globals.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/cpu.h>
#include <linux/of_fdt.h>
#include <linux/sched.h>

int __cpu_up(unsigned int cpu, struct task_struct *idle)
{
	task_thread_info(idle)->cpu = cpu;
	wasm_bringup_secondary(cpu, idle);
	while (!cpu_online(cpu)) cpu_relax();
	return 0;
}

static void noinline_for_stack start_secondary_inner(int cpu,
						     struct task_struct *idle)
{
	set_current_cpu(cpu);
	set_current_task(idle);

	BUG_ON(cpu_online(cpu));
	set_cpu_online(cpu, true);

	early_printk("== BRINGUP SECONDARY CPU %d ==\n", cpu);

	mmgrab(&init_mm);
	current->active_mm = &init_mm;

	local_irq_enable();

	notify_cpu_starting(cpu);

	pr_info("init %i\n", task_thread_info(idle)->cpu);

	cpu_startup_entry(CPUHP_AP_ONLINE_IDLE);
}

__attribute__((export_name("secondary"))) void
_start_secondary(int cpu, struct task_struct *idle)
{
	set_stack_pointer(task_pt_regs(idle) - 1);
	start_secondary_inner(cpu, idle);
}

static struct {
	unsigned long bits ____cacheline_aligned;
} ipi_data[NR_CPUS] __cacheline_aligned = { 0 };

enum ipi_message_type {
	IPI_RESCHEDULE,
	IPI_CPU_STOP,
};

static void send_ipi_message(const struct cpumask *to_whom,
			     enum ipi_message_type operation)
{
	int i;

	mb();
	for_each_cpu(i, to_whom)
		set_bit(operation, &ipi_data[i].bits);
}

/* Called early in main to prepare the boot cpu */
void __init smp_prepare_boot_cpu(void)
{
	current_thread_info()->cpu = 0;
}

/* Called in main to prepare secondary cpus */
void __init smp_prepare_cpus(unsigned int max_cpus)
{
	memset(ipi_data, 0, sizeof(ipi_data));
}

void smp_send_stop(void)
{
	cpumask_t to_whom;
	wasm_halt();
	BUG();
	cpumask_copy(&to_whom, cpu_online_mask);
	cpumask_clear_cpu(smp_processor_id(), &to_whom);
	send_ipi_message(&to_whom, IPI_CPU_STOP);
}

void smp_send_reschedule(int cpu)
{
	BUG();
	send_ipi_message(cpumask_of(cpu), IPI_RESCHEDULE);
}

void arch_smp_send_reschedule(int cpu)
{
	BUG();
}

void arch_send_call_function_ipi_mask(const struct cpumask *mask)
{
	BUG();
}

void arch_send_call_function_single_ipi(int cpu)
{
	BUG();
}

void smp_cpus_done(unsigned int max_cpus)
{
	BUG();
}

/* called on enter interrupt
 * TODO(wasm): actually do the call
 */
void handle_ipi(struct pt_regs *regs)
{
	int this_cpu = smp_processor_id();
	unsigned long *pending_ipis = &ipi_data[this_cpu].bits;
	unsigned long ops;

	mb(); /* Order interrupt and bit testing. */
	while ((ops = xchg(pending_ipis, 0)) != 0) {
		mb(); /* Order bit clearing and data access. */
		do {
			unsigned long which;

			which = ops & -ops;
			ops &= ~which;
			which = __ffs(which);

			switch (which) {
			case IPI_CPU_STOP:
				wasm_halt();
				__builtin_trap();
			default:
				printk(KERN_CRIT "Unknown IPI on CPU %d: %lu\n",
				       this_cpu, which);
				break;
			}
		} while (ops);

		mb(); /* Order data access and bit testing. */
	}
}
