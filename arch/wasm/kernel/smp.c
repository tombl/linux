#include <asm/wasm_imports.h>
#include <linux/cpumask.h>
#include <linux/of_fdt.h>
#include <linux/sched.h>

int __cpu_up(unsigned int cpu, struct task_struct *idle)
{
	__builtin_trap();
}

static int __init get_cpu_map(const char *name, struct cpumask *cpumask)
{
	unsigned long dt_root = of_get_flat_dt_root();
	const char *buf;

	buf = of_get_flat_dt_prop(dt_root, name, NULL);
	if (!buf)
		return -EINVAL;

	if (cpulist_parse(buf, cpumask))
		return -EINVAL;

	return 0;
}

void __init smp_init_cpus(void)
{
	struct cpumask cpumask;

	if (get_cpu_map("possible-cpus", &cpumask))
		panic("Failed to get possible-cpus from dtb");

	if (!cpumask_test_cpu(0, &cpumask))
		panic("Master cpu (cpu[0]) is missed in cpu possible mask!");

	init_cpu_possible(&cpumask);
}

#ifdef CONFIG_SMP
void smp_prepare_boot_cpu(void)
{
}
#endif

void smp_prepare_cpus(unsigned int max_cpus)
{
	for (int i = 0; i < NR_CPUS; i++)
		set_cpu_possible(i, true);
	__builtin_trap();
}

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
