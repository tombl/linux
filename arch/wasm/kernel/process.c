#include <asm/delay.h>
#include <asm/globals.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/entry-common.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

struct task_bootstrap_args {
	struct task_struct *task;
	int (*fn)(void *);
	void *fn_arg;
};

int arch_dup_task_struct(struct task_struct *dst, struct task_struct *src)
{
	*dst = *src;
	atomic_set(&task_thread_info(dst)->running_cpu, -1);
	return 0;
}

struct task_struct *__switch_to(struct task_struct *from,
				struct task_struct *to)
{
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);
	struct task_struct *prev;
	int cpu, other_cpu;

	cpu = atomic_xchg(&from_info->running_cpu, -1);
	BUG_ON(current != from);
	BUG_ON(cpu < 0 || cpu != get_current_cpu());

	// give the current cpu to the new worker
	other_cpu = atomic_cmpxchg(&to_info->running_cpu, -1, cpu);
	BUG_ON(other_cpu != -1); // new process should not have had a cpu

	// wake the other worker:
	// pr_info("wake cpu=%i task=%p\n", cpu, to);
	BUG_ON(__builtin_wasm_memory_atomic_notify(
		       &to_info->running_cpu.counter,
		       /* at most, wake up: */ 1) > 1);

	// pr_info("waiting cpu=%i task=%p in switch\n", cpu, from);

	// this is set to true in do_task_dead:
	if (wasm_get_thread_done())
		wasm_kernel_halt_worker();

	// sleep this worker:
	/*
	 * A wake is only a hint that ownership may have changed. Recheck the
	 * predicate: engines may return from an infinite atomic wait while the
	 * value still matches, without another worker assigning us a CPU.
	 */
	do {
		__builtin_wasm_memory_atomic_wait32(
			&from_info->running_cpu.counter,
			/* block if the value is: */ -1,
			/* timeout: */ -1);
		cpu = atomic_read(&from_info->running_cpu);
	} while (cpu < 0);

	BUG_ON(cpu >= nr_cpu_ids || cpu != from_info->cpu);
	set_current_cpu(cpu);
	prev = get_current_task_on(cpu);
	set_current_task(current);

	// pr_info("woke up cpu=%i task=%p in switch\n", cpu, from);

	return prev;
}

static void noinline_for_stack task_entry_inner(struct task_bootstrap_args *args)
{
	struct task_struct *task = args->task;
	int (*fn)(void *) = args->fn;
	int fn_ret;
	void *fn_arg = args->fn_arg;
	struct thread_info *info = task_thread_info(task);
	struct task_struct *prev;
	int cpu, ret;

	// early_printk("                       waiting cpu=%i task=%p in entry\n",
	// 	     atomic_read(&info->running_cpu), task);

	// if we don't currently have a cpu, wait for one
	for (;;) {
		cpu = atomic_read(&info->running_cpu);
		if (cpu >= 0)
			break;

		ret = __builtin_wasm_memory_atomic_wait32(
			&info->running_cpu.counter,
			/* block if the value is: */ -1,
			/* timeout: 1s */ 1000 * 1000 * 1000);
		if (ret == 2 && atomic_read(&info->running_cpu) < 0)
			early_printk("task %p %s %d is waiting for cpu in entry\n",
				     task, task->comm, task->pid);
	}

	BUG_ON(cpu >= nr_cpu_ids || cpu != info->cpu);
	set_current_cpu(cpu);

	prev = get_current_task_on(raw_smp_processor_id());
	set_current_task(task);

	kfree(args);

	// early_printk(
	// 	"                       woke up cpu=%i task=%p prev=%p kcpu=%i in entry\n",
	// 	raw_smp_processor_id(), task, prev, info->cpu);

	schedule_tail(prev);

	BUG_ON(!fn);

	// callback returns when the kernel thread execs a process
	fn_ret = fn(fn_arg);

	wasm_user_call();

	// if we're here, either the thread returned from its entrypoint without exiting,
	// or its entrypoint threw an error (likely either an `unreachable` instruction being
	// executed, or an out of range memory access.)

	local_irq_enable();
	do_exit(SIGSEGV);
}

static void task_entry(void *args)
{
	set_stack_pointer(
		task_pt_regs(((struct task_bootstrap_args *)args)->task) - 1);
	task_entry_inner(args);
}

int wasm_call_clone_fn(void *arg);

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct pt_regs *childregs = task_pt_regs(p);
	struct task_bootstrap_args *bootstrap_args;
	enum wasm_user_memory user_memory = WASM_USER_MEMORY_NONE;
	char name[TASK_COMM_LEN + 16] = { 0 };
	int name_len;
	int ret;

	memset(childregs, 0, sizeof(struct pt_regs));

	atomic_set(&task_thread_info(p)->running_cpu, -1);
	if (args->flags & CLONE_SETTLS)
		task_thread_info(p)->tp_value = args->tls;

	// don't spawn a worker for idle threads
	// this is probably a bad idea
	if (args->idle)
		return 0;

	bootstrap_args =
		kzalloc(sizeof(struct task_bootstrap_args), GFP_KERNEL);
	if (!bootstrap_args)
		return -ENOMEM;
	bootstrap_args->fn = args->fn;
	bootstrap_args->fn_arg = args->fn_arg;
	bootstrap_args->task = p;

	name_len = snprintf(name, ARRAY_SIZE(name), "%s (%d)", p->comm, p->pid);

	if (args->fn == wasm_call_clone_fn)
		user_memory = args->flags & CLONE_VM ?
			WASM_USER_MEMORY_SHARE : WASM_USER_MEMORY_COPY;

	ret = wasm_kernel_spawn_worker(&task_entry, bootstrap_args, name,
				       name_len, user_memory);
	if (ret) {
		kfree(bootstrap_args);
		return ret;
	}

	return 0;
}
