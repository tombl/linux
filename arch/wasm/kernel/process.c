#include <linux/sched.h>
#include <linux/sched/task.h>

void *__switch_to(struct task_struct *from, struct task_struct *to)
{
	__builtin_trap();
}

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	__builtin_trap();
}