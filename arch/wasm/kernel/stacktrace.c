#include <linux/printk.h>
#include <linux/sched.h>

void show_stack(struct task_struct *task, unsigned long *sp, const char *loglvl)
{
	early_printk("%sStack from %s (%pg):\n", loglvl, task->comm, task);
}
