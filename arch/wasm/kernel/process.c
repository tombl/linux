#include "linux/thread_info.h"
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/slab.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

void arch_cpu_idle(void)
{
	wasm_idle();
}

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
	// struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);

	to_info->from_sched = from;

	pr_info("context switch CPU: %i PID: %u -> %u STACK: %p -> %p\n",
		smp_processor_id(), from->pid, to->pid, get_stack_pointer(),
		to->stack);

	set_stack_pointer(to->stack);
	current = to;

	return from;
}

struct entry_arg {
	int cpu;
	struct thread_info *thread_info;
	int (*fn)(void *);
	void *fn_arg;
};
void show_stack(struct task_struct *task, unsigned long *sp,
		const char *loglvl);

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct entry_arg *entry;

	if (!args->fn) panic("can't copy userspace thread"); // yet

	entry = kmalloc(sizeof(*entry), GFP_KERNEL);
	if (!entry)
		return -ENOMEM;

	entry->fn = args->fn;
	entry->fn_arg = args->fn_arg;
	entry->thread_info = task_thread_info(p);

	wasm_new_worker(entry, p->comm);

	return 0;
}

static atomic_t next_cpu_nr = ATOMIC_INIT(1);
void noinline_for_stack task_entry_inner(struct entry_arg *entry)
{
	int (*fn)(void *) = entry->fn;
	void *fn_arg = entry->fn_arg;
	struct thread_info *thread_info = entry->thread_info;
	int cpu;
	kfree(entry);

	cpu = atomic_inc_return(&next_cpu_nr);
	smp_tls_init(cpu);
	current = thread_info->from_sched;
	current_thread_info()->cpu = cpu;
	pr_info("== THREAD ENTRY! CPU: %i ==", cpu);

	if (thread_info->from_sched)
		schedule_tail(thread_info->from_sched);

	fn(fn_arg);

	do_exit(0);
}

__attribute__((export_name("task_entry"))) void
task_entry(struct entry_arg *entry)
{
	set_stack_pointer(entry->thread_info->task->stack);
	task_entry_inner(entry);
}
