#include <asm/delay.h>
#include <asm/globals.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/entry-common.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

// TODO(wasm): replace __builtin_wasm_memory_atomic with completion?

struct task_bootstrap_args {
	struct task_struct *task;
	int (*fn)(void *);
	void *fn_arg;
};

// noinline for debugging purposes
struct task_struct *noinline __switch_to(struct task_struct *from,
					 struct task_struct *to)
{
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);
	struct task_struct *prev;
	int cpu, other_cpu;

	cpu = atomic_xchg(&from_info->running_cpu, -1);
	BUG_ON(cpu < 0); // current process must be scheduled to a cpu

	// give the current cpu to the new worker
	other_cpu = atomic_cmpxchg(&to_info->running_cpu, -1, cpu);
	BUG_ON(other_cpu != -1); // new process should not have had a cpu

	// wake the other worker:
	// pr_info("wake cpu=%i task=%p\n", cpu, to);
	BUG_ON(__builtin_wasm_memory_atomic_notify(
		       &to_info->running_cpu.counter,
		       /* at most, wake up: */ 1) > 1);

	// pr_info("waiting cpu=%i task=%p in switch\n", cpu, from);

	// sleep this worker:
	/* memory.atomic.wait32 returns:
	 * 0 -> the thread blocked and was woken
		= we slept and were woken
	 * 1 -> the value at the pointer didn't match the passed value
	 	= somebody gave us their cpu straight away
	 * 2 -> the thread blocked but timed out
	 	= not possible because we pass an infinite timeout
	*/
	__builtin_wasm_memory_atomic_wait32(&from_info->running_cpu.counter,
					    /* block if the value is: */ -1,
					    /* timeout: */ -1);
	cpu = atomic_read(&from_info->running_cpu);
	BUG_ON(cpu < 0); // we should be given a new cpu
	set_current_cpu(cpu);
	prev = get_current_task_on(cpu);
	set_current_task(current);

	// pr_info("woke up cpu=%i task=%p in switch\n", cpu, from);

	return prev;
}

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct pt_regs *childregs = task_pt_regs(p);
	struct task_bootstrap_args *bootstrap_args;
	char name[TASK_COMM_LEN + 16] = { 0 };
	int name_len;

	memset(childregs, 0, sizeof(struct pt_regs));

	atomic_set(&task_thread_info(p)->running_cpu, -1);

	// don't spawn a worker for idle threads
	// this is probably a bad idea
	if (args->idle) return 0;

	if (!args->fn)
		panic("can't copy userspace thread"); // yet

	bootstrap_args =
		kzalloc(sizeof(struct task_bootstrap_args), GFP_KERNEL);
	if (!bootstrap_args)
		panic("can't allocate bootstrap args");

	bootstrap_args->task = p;
	bootstrap_args->fn = args->fn;
	bootstrap_args->fn_arg = args->fn_arg;

	name_len = snprintf(name, ARRAY_SIZE(name), "%s (%d)", p->comm, p->pid);

	wasm_new_worker(bootstrap_args, name, name_len);

	return 0;
}

static void noinline_for_stack start_task_inner(struct task_bootstrap_args *args)
{
	struct task_struct *task = args->task;
	int (*fn)(void *) = args->fn;
	int fn_ret;
	void *fn_arg = args->fn_arg;
	struct thread_info *info = task_thread_info(task);
	struct task_struct *prev;

	// early_printk("                       waiting cpu=%i task=%p in entry\n",
	// 	     atomic_read(&info->running_cpu), task);

	// if we don't currently have a cpu, wait for one
	for (;;) {
		int ret = __builtin_wasm_memory_atomic_wait32(
			&info->running_cpu.counter,
			/* block if the value is: */ -1,
			/* timeout: 1s */ 1000 * 1000 * 1000);
		if (ret != 2) // 2 means timeout
			break;
		early_printk("task %p %s %d is waiting for cpu in entry\n",
			     task, task->comm, task->pid);
	}

	set_current_cpu(atomic_read(&info->running_cpu));
	BUG_ON(raw_smp_processor_id() < 0);

	prev = get_current_task_on(raw_smp_processor_id());
	set_current_task(task);

	kfree(args);

	// early_printk(
	// 	"                       woke up cpu=%i task=%p prev=%p kcpu=%i in entry\n",
	// 	raw_smp_processor_id(), task, prev, info->cpu);

	schedule_tail(prev);

	// callback returns only if the kernel thread execs a process
	fn_ret = fn(fn_arg);

	// call into userspace?
	pr_info("task finished on cpu %d\n", raw_smp_processor_id());

	do_exit(0);

	// syscall_exit_to_user_mode(&(struct pt_regs){ 0 });
}

__attribute__((export_name("task"))) void
_start_task(struct task_bootstrap_args *args)
{
	set_stack_pointer(task_pt_regs(args->task) - 1);
	start_task_inner(args);
}
