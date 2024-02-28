#include <asm/wasm_imports.h>
#include <linux/slab.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

__asm__(".globaltype __stack_pointer, i32\n");

static void *get_stack_pointer(void)
{
	void *ptr;
	__asm("global.get __stack_pointer\n"
	      "local.set %0"
	      : "=r"(ptr));
	return ptr;
}

static void __always_inline set_stack_pointer(void *ptr)
{
	__asm("local.get %0\n"
	      "global.set __stack_pointer" ::"r"(ptr));
}

struct task_struct *__switch_to(struct task_struct *from,
				struct task_struct *to)
{
	struct pt_regs *from_regs = task_pt_regs(from);
	struct pt_regs *to_regs = task_pt_regs(to);

	from_regs->current_stack = get_stack_pointer();

	pr_info("context switch PID: %u STACK: %p\n"
		"->                  %u        %p\n",
		from->pid, from_regs->current_stack, to->pid,
		to_regs->current_stack);

	set_stack_pointer(to_regs->current_stack);

	current = to;

	schedule_tail(from);

	pr_info("regs: %p\n", to_regs);
	BUG_ON(!to_regs->fn);

	pr_info("about to call %p %p\n", to_regs->fn, to_regs->fn_arg);
	to_regs->fn(to_regs->fn_arg);
	to_regs->fn = NULL;

	return from;
}

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct pt_regs *childregs = task_pt_regs(p);

	memset(childregs, 0, sizeof(struct pt_regs));

	childregs->current_stack = childregs;

	if (!args->fn)
		panic("can't copy userspace thread"); // yet

	pr_info("copying thread %i %p\n", p->pid, childregs);

	childregs->fn = args->fn;
	childregs->fn_arg = args->fn_arg;

	return 0;
}
