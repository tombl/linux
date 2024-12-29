#include "asm/wasm_imports.h"
#include "linux/slab.h"
#include <linux/printk.h>
#include <linux/sched.h>

void show_stack(struct task_struct *task, unsigned long *sp, const char *loglvl)
{
	char *trace = kmalloc(1024, GFP_KERNEL);
	if (!trace)
		printk("%sFailed to allocate memory for trace\n", loglvl);

	if (task)
		printk("%sStack from %s (%pg):\n", loglvl, task->comm, task);
	else
		printk("%sStack:\n", loglvl);

	wasm_kernel_get_stacktrace(trace, 1024);
	printk("%s%s", loglvl, trace);
	kfree(trace);
}
