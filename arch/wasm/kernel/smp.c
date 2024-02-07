#include <asm/wasm_imports.h>
#include <linux/cpumask.h>
#include <linux/sched.h>

int __cpu_up(unsigned int cpu, struct task_struct *idle)
{
	__builtin_trap();
}

// void __init smp_prepare_boot_cpu(void) {}

void smp_prepare_cpus(unsigned int max_cpus)
{
	__builtin_trap();
}

// void smp_send_stop(void)
// {
// 	pr_info("smp_send_stop\n");
// }

void arch_smp_send_reschedule(int cpu)
{
	__builtin_trap();
}

void arch_send_call_function_ipi_mask(const struct cpumask *mask)
{
	__builtin_trap();
}

void arch_send_call_function_single_ipi(int cpu)
{
	__builtin_trap();
}

void smp_cpus_done(unsigned int max_cpus)
{
	__builtin_trap();
}
