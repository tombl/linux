#include <asm/wasm_imports.h>
#include <linux/slab.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

__asm__(".globaltype __stack_pointer, i32\n");

int setjmp(void *buf) __attribute__((returns_twice));
void longjmp(void *buf, int val) __attribute__((noreturn));

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
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);

	// the following call crashes clang:
	// from_info->jmpbuf = kmalloc(40, 0);

	// to_info->from_sched = from;
	current = to;
	from_regs->current_stack = get_stack_pointer();

	
	if (setjmp(from_info->jmpbuf) == 0) {
		set_stack_pointer(to_regs->current_stack);
		
		schedule_tail(from);
		pr_info("switch %u -> %u\n", from->pid, to->pid);
		// if (to_info->from_sched)
		// 	schedule_tail(to_info->from_sched);
		// to_info->from_sched = NULL;

		if (to_regs->fn) {
			int (*fn)(void *) = to_regs->fn;
			to_regs->fn = NULL;

			// callback returns if the kernel thread execs a process?
			fn(to_regs->fn_arg);
		} else {
			longjmp(to_info->jmpbuf, 1);
		}
	}

	kfree(from_info->jmpbuf);

	// pr_info("hi %u %u %u\n", from->pid, to->pid, current->pid);
	// return current_thread_info()->from_sched;
	return from;

	// from_regs->current_stack = get_stack_pointer();

	// if (setjmp(from_info->jmpbuf) == 0) {
	// 	pr_info("context switch %u %p\n"
	// 		"            -> %u %p\n",
	// 		from->pid, from_regs->current_stack, to->pid,
	// 		to_regs->current_stack);

	// 	set_stack_pointer(to_regs->current_stack);
	// 	pr_info("before jmp %u -> %u\n", current->pid, to->pid);
	// 	current = to;

	// 	schedule_tail(from);

	// 	pr_info("regs: %p %p\n", to_regs, to_regs->fn);

	// 	longjmp(to_info->jmpbuf, 1);
	// }

	// set_stack_pointer(from_regs->current_stack);
	// pr_info("resuming from jmp %u -> %u\n", current->pid, from->pid);
	// current = from;

	// return from;
}

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct pt_regs *childregs = task_pt_regs(p);

	memset(childregs, 0, sizeof(struct pt_regs));

	childregs->current_stack = childregs - 1;

	if (!args->fn)
		panic("can't copy userspace thread"); // yet

	// pr_info("copying thread %i %p\n", p->pid, childregs);

	childregs->fn = args->fn;
	childregs->fn_arg = args->fn_arg;

	return 0;
}
