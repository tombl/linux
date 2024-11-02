#include <asm/globals.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/cpu.h>
#include <linux/interrupt.h>
#include <linux/irq_work.h>
#include <linux/irqdomain.h>
#include <linux/irqreturn.h>
#include <linux/of_fdt.h>
#include <linux/sched.h>
#include <linux/seq_file.h>

DECLARE_COMPLETION(cpu_starting);

static void noinline_for_stack secondary_entry_inner(struct task_struct *idle)
{
	int cpu = task_thread_info(idle)->cpu;
	set_current_cpu(cpu);
	set_current_task(idle);
	atomic_set(&current_thread_info()->running_cpu, cpu);

	BUG_ON(cpu_online(cpu));
	set_cpu_online(cpu, true);

	mmgrab(&init_mm);
	current->active_mm = &init_mm;

	local_irq_enable();

	notify_cpu_starting(cpu);
	complete(&cpu_starting);

	pr_info("Hello from cpu %i!\n", raw_smp_processor_id());

	cpu_startup_entry(CPUHP_AP_ONLINE_IDLE);

	BUG(); // should never get here
}

static void secondary_entry(void *idle)
{
	set_stack_pointer(task_pt_regs(((struct task_struct *)idle)) - 1);
	secondary_entry_inner(idle);
}

int __cpu_up(unsigned int cpu, struct task_struct *idle)
{
	char name[8] = { 0 };
	int name_len = snprintf(name, ARRAY_SIZE(name), "entry%d", cpu);
	task_thread_info(idle)->cpu = cpu;
	wasm_kernel_spawn_worker(secondary_entry, idle, "entry", name_len);
	wait_for_completion(&cpu_starting);
	return 0;
}

enum ipi_message_type {
	IPI_EMPTY,
	IPI_RESCHEDULE,
	IPI_CPU_STOP,
	IPI_IRQ_WORK,
	IPI_CALL_FUNC,
	IPI_MAX,
};

struct ipi_data_struct {
	unsigned long bits ____cacheline_aligned;
	unsigned long stats[IPI_MAX] ____cacheline_aligned;
};
static DEFINE_PER_CPU(struct ipi_data_struct, ipi_data);

void trigger_irq_for_cpu(unsigned int cpu, unsigned int irq);

static void send_ipi_message(const struct cpumask *to_whom,
			     enum ipi_message_type operation)
{
	int i;

	for_each_cpu(i, to_whom)
		set_bit(operation, &per_cpu_ptr(&ipi_data, i)->bits);

	smp_mb();

	for_each_cpu(i, to_whom)
		trigger_irq_for_cpu(i, IPI_IRQ);
}

static const char *const ipi_names[] = {
	[IPI_EMPTY] = "Empty interrupts",
	[IPI_RESCHEDULE] = "Rescheduling interrupts",
	[IPI_CPU_STOP] = "CPU stop interrupts",
	[IPI_CALL_FUNC] = "Function call interrupts",
	[IPI_IRQ_WORK] = "Irq work interrupts",
};

int arch_show_interrupts(struct seq_file *p, int prec)
{
	unsigned int cpu, i;

	for (i = 0; i < IPI_MAX; i++) {
		seq_printf(p, "%*s%u:%s", prec - 1, "IPI", i,
			   prec >= 4 ? " " : "");
		for_each_online_cpu(cpu)
			seq_printf(p, "%10lu ",
				   per_cpu_ptr(&ipi_data, cpu)->stats[i]);
		seq_printf(p, " %s\n", ipi_names[i]);
	}

	return 0;
}

/* Called early in main to prepare the boot cpu */
void __init smp_prepare_boot_cpu(void)
{
	BUG_ON(smp_processor_id() != 0);
}

/* Called in main to prepare secondary cpus */
void __init smp_prepare_cpus(unsigned int max_cpus)
{
	unsigned int i;
	for_each_possible_cpu(i)
		if (i < max_cpus)
			set_cpu_present(i, true);
}

void __init smp_init_cpus(unsigned int ncpus)
{
	pr_info("Core count: %d\n", ncpus);

	if (ncpus > NR_CPUS) {
		ncpus = NR_CPUS;
		pr_info("Limiting core count to maximum: %d\n", ncpus);
	}

	for (int i = 0; i < ncpus; i++)
		set_cpu_possible(i, true);
}

void smp_send_stop(void)
{
	struct cpumask targets;
	cpumask_copy(&targets, cpu_online_mask);
	cpumask_clear_cpu(smp_processor_id(), &targets);
	send_ipi_message(&targets, IPI_CPU_STOP);
}

void smp_send_reschedule(int cpu)
{
	send_ipi_message(cpumask_of(cpu), IPI_RESCHEDULE);
}

#ifdef CONFIG_IRQ_WORK
void arch_irq_work_raise(void)
{
	send_ipi_message(cpumask_of(smp_processor_id()), IPI_IRQ_WORK);
}
#endif

void arch_send_call_function_ipi_mask(const struct cpumask *mask)
{
	send_ipi_message(mask, IPI_CALL_FUNC);
}

void arch_send_call_function_single_ipi(int cpu)
{
	send_ipi_message(cpumask_of(cpu), IPI_CALL_FUNC);
}

void __init smp_cpus_done(unsigned int max_cpus)
{
}

static irqreturn_t handle_ipi(int irq, void *dev)
{
	unsigned long *stats = this_cpu_ptr(&ipi_data)->stats;

	for (;;) {
		unsigned long ops = xchg(&this_cpu_ptr(&ipi_data)->bits, 0);

		if (ops == 0)
			return IRQ_HANDLED;

		if (ops & (1 << IPI_RESCHEDULE)) {
			stats[IPI_RESCHEDULE]++;
			scheduler_ipi();
		}

		if (ops & (1 << IPI_CPU_STOP)) {
			stats[IPI_CPU_STOP]++;
			wasm_kernel_halt();
		}

		if (ops & (1 << IPI_CALL_FUNC)) {
			stats[IPI_CALL_FUNC]++;
			generic_smp_call_function_interrupt();
		}

		if (ops & (1 << IPI_IRQ_WORK)) {
			stats[IPI_IRQ_WORK]++;
			irq_work_run();
		}

		BUG_ON((ops >> IPI_MAX) != 0);
	}
}

void __init setup_smp_ipi(void)
{
	static int dummy_dev;
	int err;

	int irq = irq_find_mapping(NULL, IPI_IRQ);
	if (!irq)
		panic("no mapping for IPI_IRQ\n");

	err = request_irq(irq, handle_ipi, 0, "ipi", &dummy_dev);
	if (err)
		panic("Failed to request irq %u (ipi): %d\n", irq, err);
}
