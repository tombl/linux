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
	__asm__ volatile("global.get __stack_pointer\n"
			 "local.set %0"
			 : "=r"(ptr));
	return ptr;
}

static void __always_inline set_stack_pointer(void *ptr)
{
	__asm__ volatile("local.get %0\n"
			 "global.set __stack_pointer" ::"r"(ptr));
}

static struct task_struct *prev = &init_task;

inline static struct task_struct *__switch_to_inner(struct task_struct *from,
						    struct task_struct *to)
{
	struct pt_regs *from_regs = task_pt_regs(from);
	struct pt_regs *to_regs = task_pt_regs(to);
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);

	if (setjmp(from_info->jmpbuf) == 0) {
		set_stack_pointer(to_regs->current_stack);

		if (to_info->from_sched)
			schedule_tail(to_info->from_sched);
		to_info->from_sched = NULL;

		if (to_regs->fn) {
			int (*fn)(void *) = to_regs->fn;
			int result;

			to_regs->fn = NULL;
			pr_info("call %p(%p)\n", fn, to_regs->fn_arg);

			// callback returns if the kernel thread execs a process?
			result = fn(to_regs->fn_arg);
			pr_info("call %p(%p) = %u\n", fn, to_regs->fn_arg,
				result);
		} else {
			pr_info("longjmp %p to %u\n", to_info->jmpbuf, to->pid);
			longjmp(to_info->jmpbuf, 1);
		}
	} else {
		pr_info("free %p\n", from_info->jmpbuf);
		kfree(from_info->jmpbuf);
	}

	return prev;
}

struct task_struct *__switch_to(struct task_struct *from,
				struct task_struct *to)
{
	struct pt_regs *from_regs = task_pt_regs(from);
	struct pt_regs *to_regs = task_pt_regs(to);
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);

	from_regs->current_stack = get_stack_pointer();
	from_info->jmpbuf = kmalloc(16, 0);

	pr_info("alloc %p for %u\n", from_info->jmpbuf, from->pid);

	current = to;
	to_info->from_sched = prev;
	prev = from;

	return __switch_to_inner(from, to);
}

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct pt_regs *childregs = task_pt_regs(p);

	memset(childregs, 0, sizeof(struct pt_regs));

	childregs->current_stack = childregs - 1;

	if (!args->fn)
		panic("can't copy userspace thread"); // yet

	childregs->fn = args->fn;
	childregs->fn_arg = args->fn_arg;

	return 0;
}
