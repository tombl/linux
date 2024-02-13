#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/printk.h>
#include <linux/ptrace.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

void arch_cpu_idle(void)
{
	wasm_idle();
}

struct task_struct *__switch_to(struct task_struct *from,
				struct task_struct *to)
{
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);

	to_info->from_sched = from;

	pr_info("context switch: %u -> %u\n", from->pid, to->pid);

	current = to;
	current_stack_pointer = task_pt_regs(to)->stack_pointer;

	return from;
}

struct entry_arg {
	struct thread_info *thread_info;
	int (*fn)(void *);
	void *fn_arg;
};
void show_stack(struct task_struct *task, unsigned long *sp,
		const char *loglvl);

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct entry_arg *entry;

	if (!args->fn) {
		panic("can't copy userspace thread");
	}

	entry = kmalloc(sizeof(*entry), GFP_KERNEL);
	if (!entry) return -ENOMEM;

	entry->fn = args->fn;
	entry->fn_arg = args->fn_arg;
	entry->thread_info = task_thread_info(p);

	pr_info("spawning: %p %p\n", entry, entry->fn);
	wasm_new_worker(entry, p->comm);

	return 0;
}

__attribute__((export_name("task_entry"))) void __init task_entry(struct entry_arg *entry)
{
	int (*fn)(void *) = entry->fn;
	void *fn_arg = entry->fn_arg;
	struct thread_info *thread_info = entry->thread_info;

	tls_init();
	current = thread_info->from_sched;

	kfree(entry);

	if (thread_info->from_sched)
		schedule_tail(thread_info->from_sched);

	fn(fn_arg);
	do_exit(0);
}
