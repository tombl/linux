#include <asm/wasm_imports.h>
#include <linux/cpumask.h>
#include <linux/of_fdt.h>
#include <linux/sched.h>

static struct {
	unsigned long bits ____cacheline_aligned;
} ipi_data[NR_CPUS] __cacheline_aligned;

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

	// mb();
	// for_each_cpu(i, to_whom)
	// 	BUG(); // TODO(wasm): postMessage interrupt to other worker
}

int __cpu_up(unsigned int cpu, struct task_struct *idle)
{
	BUG();
}

void __init smp_init_cpus(void)
{
	BUG();
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

	pr_info("SMP bringup with %i parallel processes\n", NR_CPUS);
}

void smp_send_stop(void)
{
	cpumask_t to_whom;
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

			default:
				printk(KERN_CRIT "Unknown IPI on CPU %d: %lu\n",
				       this_cpu, which);
				break;
			}
		} while (ops);

		mb(); /* Order data access and bit testing. */
	}
}
