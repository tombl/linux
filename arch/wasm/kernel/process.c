#include <asm/delay.h>
#include <asm/globals.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/sched.h>
#include <linux/sched/task_stack.h>
#include <linux/sched/task.h>

// TODO(wasm): replace __builtin_wasm_memory_atomic with completion?

// noinline for debugging purposes
struct task_struct *noinline __switch_to(struct task_struct *from,
					 struct task_struct *to)
{
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);
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

	pr_info("waiting cpu=%i task=%p in switch\n", cpu, from);

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

	pr_info("woke up cpu=%i task=%p in switch\n", cpu, from);

	BUG_ON(cpu < 0); // we should be given a new cpu

	return current;
}

int copy_thread(struct task_struct *p, const struct kernel_clone_args *args)
{
	struct pt_regs *childregs = task_pt_regs(p);

	memset(childregs, 0, sizeof(struct pt_regs));

	atomic_set(&task_thread_info(p)->running_cpu, -1);

	if (!args->fn)
		panic("can't copy userspace thread"); // yet

	childregs->fn = args->fn;
	childregs->fn_arg = args->fn_arg;

	pr_info("spawning task=%p %s %d\n", p, p->comm, *(int *)p->sched_class);
	wasm_new_worker(raw_smp_processor_id(), p, p->comm, strnlen(p->comm, TASK_COMM_LEN));

	return 0;
}

static void noinline_for_stack start_task_inner(int cpu,
						struct task_struct *task)
{
	struct thread_info *info = task_thread_info(task);
	struct pt_regs *regs = task_pt_regs(task);
	struct task_struct *prev;

	set_current_cpu(cpu);

	early_printk("                       waiting cpu=%i task=%p in entry\n",
		     atomic_read(&info->running_cpu), task);

	// if we don't currently have a cpu, wait for one
	__builtin_wasm_memory_atomic_wait32(&info->running_cpu.counter,
					    /* block if the value is: */ -1,
					    /* timeout: */ -1);
	prev = current;
	current_tasks[raw_smp_processor_id()] = task;

	cpu = atomic_read(&info->running_cpu);

	early_printk(
		"                       woke up cpu=%i task=%p kcpu=%i in entry\n",
		cpu, task, info->cpu);

	pr_info("schedule_tail(%p %d %s)\n", prev, prev->pid, prev->comm);
	schedule_tail(prev);

	pr_info("fn %p(%p)\n", regs->fn, regs->fn_arg);
	// callback returns only if the kernel thread execs a process
	regs->fn(regs->fn_arg);

	// call into userspace?
	panic("can't call userspace\n");
}

__attribute__((export_name("task"))) void _start_task(int cpu,
						      struct task_struct *task)
{
	set_stack_pointer(task_pt_regs(task) - 1);
	start_task_inner(cpu, task);
}
