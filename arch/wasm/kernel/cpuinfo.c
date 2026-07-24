#include <linux/seq_file.h>

static void percpu_print(void *arg)
{
	struct seq_file *m = arg;
	seq_printf(m, "processor       : %d\n", smp_processor_id());
	seq_printf(m, "\n");
}

static int c_show(struct seq_file *m, void *v)
{
	int cpu;

	for_each_online_cpu(cpu)
		smp_call_function_single(cpu, percpu_print, m, true);

	return 0;
}

static void *c_start(struct seq_file *m, loff_t *pos)
{
	return *pos < 1 ? (void *)1 : NULL;
}

static void *c_next(struct seq_file *m, void *v, loff_t *pos)
{
	++*pos;
	return NULL;
}

static void c_stop(struct seq_file *m, void *v)
{
}

const struct seq_operations cpuinfo_op = {
	.start = c_start,
	.next = c_next,
	.stop = c_stop,
	.show = c_show,
};
