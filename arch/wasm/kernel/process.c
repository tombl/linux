#include <asm/delay.h>
#include <asm/globals.h>
#include <asm/remote_vm.h>
#include <asm/spawn.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/entry-common.h>
#include <linux/interrupt.h>
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
	atomic_set(&task_thread_info(dst)->running_cpu, WASM_CPU_PARKED);
	task_thread_info(dst)->context_mm = NULL;
	task_thread_info(dst)->active_siginfo = NULL;
	task_thread_info(dst)->handler_escaped = 0;
	task_thread_info(dst)->exec_handoff = false;
	task_thread_info(dst)->exec_restart = false;
	task_thread_info(dst)->borrowed_user_memory = false;
	task_thread_info(dst)->exec_preparing = false;
	return 0;
}

/*
 * Runs the task's user image until its entry point returns or faults. An exec
 * in place abandons the old image's frames, including the kernel frames of a
 * syscall whose signal handler called execve, so restart the new image on the
 * kernel stack as this frame found it.
 */
static void __noreturn run_user(void)
{
	void *sp = get_stack_pointer();

	while (wasm_user_call())
		set_stack_pointer(sp);

	// if we're here, either the thread returned from its entrypoint without exiting,
	// or its entrypoint threw an error (likely either an `unreachable` instruction being
	// executed, or an out of range memory access.)

	local_irq_enable();
	do_exit(SIGSEGV);
}

struct task_struct *__switch_to(struct task_struct *from,
				struct task_struct *to)
{
	struct thread_info *from_info = task_thread_info(from);
	struct thread_info *to_info = task_thread_info(to);
	struct task_struct *prev;
	int cpu, other_cpu;

	cpu = atomic_xchg(&from_info->running_cpu, WASM_CPU_PARKED);
	BUG_ON(current != from);
	BUG_ON(cpu < 0 || cpu != get_current_cpu());

	/*
	 * Give the current cpu to the new worker. A remote request may have
	 * changed PARKED to REMOTE_WAKE concurrently; either negative state is
	 * unscheduled and may receive the cpu. If this consumes REMOTE_WAKE,
	 * the worker services the still-published request after waking.
	 */
	do {
		other_cpu = atomic_read(&to_info->running_cpu);
		BUG_ON(other_cpu >= 0);
	} while (atomic_cmpxchg(&to_info->running_cpu, other_cpu, cpu) !=
		 other_cpu);

	// wake the other worker:
	// pr_info("wake cpu=%i task=%p\n", cpu, to);
	BUG_ON(__builtin_wasm_memory_atomic_notify(
		       &to_info->running_cpu.counter,
		       /* at most, wake up: */ 1) > 1);

	// pr_info("waiting cpu=%i task=%p in switch\n", cpu, from);

	// this is set to true in do_task_dead:
	if (wasm_get_thread_done())
		wasm_kernel_halt_worker();

	/*
	 * This task no longer owns a logical CPU. Service after publishing the
	 * parked state so a concurrent requester either sees its request here
	 * or changes the waited-on value to REMOTE_WAKE below.
	 */
	wasm_service_remote_request(from);

	// sleep this worker:
	for (;;) {
		cpu = atomic_read(&from_info->running_cpu);
		if (cpu >= 0)
			break;
		if (cpu == WASM_CPU_REMOTE_WAKE) {
			/*
			 * Acknowledge before servicing. Clearing afterward could
			 * erase the kick belonging to a newly-published request.
			 */
			if (atomic_cmpxchg(&from_info->running_cpu,
					   WASM_CPU_REMOTE_WAKE,
					   WASM_CPU_PARKED) ==
			    WASM_CPU_REMOTE_WAKE)
				wasm_service_remote_request(from);
			continue;
		}

		BUG_ON(cpu != WASM_CPU_PARKED);
		__builtin_wasm_memory_atomic_wait32(
			&from_info->running_cpu.counter,
			/* block if the value is: */ WASM_CPU_PARKED,
			/* timeout: */ -1);
	}

	BUG_ON(cpu >= nr_cpu_ids || cpu != from_info->cpu);
	set_current_cpu(cpu);
	prev = get_current_task_on(cpu);
	set_current_task(current);
	wasm_service_remote_request(from);

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
		if (cpu == WASM_CPU_REMOTE_WAKE) {
			if (atomic_cmpxchg(&info->running_cpu,
					   WASM_CPU_REMOTE_WAKE,
					   WASM_CPU_PARKED) ==
			    WASM_CPU_REMOTE_WAKE)
				wasm_service_remote_request(task);
			continue;
		}

		BUG_ON(cpu != WASM_CPU_PARKED);
		ret = __builtin_wasm_memory_atomic_wait32(
			&info->running_cpu.counter,
			/* block if the value is: */ WASM_CPU_PARKED,
			/* timeout: 1s */ 1000 * 1000 * 1000);
		if (ret == 2 && atomic_read(&info->running_cpu) < 0)
			early_printk("task %p %s %d is waiting for cpu in entry\n",
				     task, task->comm, task->pid);
	}

	BUG_ON(cpu >= nr_cpu_ids || cpu != info->cpu);
	set_current_cpu(cpu);

	prev = get_current_task_on(raw_smp_processor_id());
	set_current_task(task);
	wasm_service_remote_request(task);

	kfree(args);

	// early_printk(
	// 	"                       woke up cpu=%i task=%p prev=%p kcpu=%i in entry\n",
	// 	raw_smp_processor_id(), task, prev, info->cpu);

	schedule_tail(prev);

	BUG_ON(!fn);

	// callback returns when the kernel thread execs a process
	fn_ret = fn(fn_arg);

	if (current_thread_info()->exec_handoff)
		wasm_user_exec_handoff();

	run_user();
}

static void task_entry(void *args)
{
	set_stack_pointer(
		task_pt_regs(((struct task_bootstrap_args *)args)->task) - 1);
	task_entry_inner(args);
}

/*
 * Exec runs the new image in a successor worker: each worker hosts one user
 * memory for its whole life, and ending the worker is the only way to release
 * that memory in every browser. The successor is spawned while exec can still
 * fail, and waits outside the kernel. Once the exec has succeeded, the old
 * worker hands over the task, still running on its logical CPU, and leaves
 * without touching the kernel stack again. The successor then completes the
 * return to userspace in the new image.
 *
 * The exception is a CLONE_VM child, whose worker hosts its parent's memory
 * until it execs: that exec runs in place, see load_wasm_binary(), and the
 * worker then hosts the child's own memory for the rest of its life.
 */
static void noinline_for_stack exec_entry_inner(struct task_struct *task)
{
	struct thread_info *info = task_thread_info(task);
	struct pt_regs *regs = task_pt_regs(task);
	int cpu = atomic_read(&info->running_cpu);

	BUG_ON(cpu < 0 || cpu >= nr_cpu_ids || cpu != info->cpu);
	set_current_cpu(cpu);
	set_current_task(task);

	info->exec_handoff = false;
	/* A signal handler that called execve was abandoned with the old image. */
	info->active_siginfo = NULL;
	/* Remote access can reach the new image through this worker now. */
	WRITE_ONCE(info->context_mm, task->mm);
	wasm_service_remote_request(task);

	syscall_exit_to_user_mode(regs);
	regs->user_mode = 1;
	run_user();
}

void wasm_exec_entry(void *arg)
{
	struct task_struct *task = arg;

	set_stack_pointer(task_pt_regs(task) - 1);
	exec_entry_inner(task);
}

/*
 * A spawn's result comes from the new worker, which may not start until
 * another worker exits: Firefox queues workers past its per-site limit. The
 * spawning task therefore sleeps on a completion and gives up its cpu, so the
 * tasks that would free a worker can run. The new worker stores its result
 * and raises spawn_irq; the handler completes every wait that has a result.
 */
static LIST_HEAD(spawn_waits);
static DEFINE_SPINLOCK(spawn_waits_lock);
static int spawn_irq = -1;

static irqreturn_t spawn_interrupt(int irq, void *dev_id)
{
	struct wasm_spawn_wait *wait, *next;
	unsigned long flags;

	spin_lock_irqsave(&spawn_waits_lock, flags);
	list_for_each_entry_safe(wait, next, &spawn_waits, node) {
		if (!READ_ONCE(wait->status))
			continue;
		list_del_init(&wait->node);
		complete(&wait->done);
	}
	spin_unlock_irqrestore(&spawn_waits_lock, flags);

	return IRQ_HANDLED;
}

static int __init spawn_wait_init(void)
{
	int irq = wasm_alloc_irq();
	int ret;

	if (irq < 0)
		return irq;
	ret = request_irq(irq, spawn_interrupt, 0, "wasm-spawn", NULL);
	if (ret) {
		wasm_free_irq(irq);
		return ret;
	}
	spawn_irq = irq;
	return 0;
}
core_initcall(spawn_wait_init);

int wasm_spawn_worker_wait(void (*fn)(void *), void *arg, char *name,
			   size_t name_len, enum wasm_user_memory user_memory)
{
	struct wasm_spawn_wait wait = { .status = 0 };
	unsigned long flags;
	int ret;

	if (WARN_ON_ONCE(spawn_irq < 0))
		return -ENODEV;
	wait.irq = spawn_irq;
	init_completion(&wait.done);

	spin_lock_irqsave(&spawn_waits_lock, flags);
	list_add_tail(&wait.node, &spawn_waits);
	spin_unlock_irqrestore(&spawn_waits_lock, flags);

	ret = wasm_kernel_spawn_worker(fn, arg, name, name_len, user_memory,
				       &wait);
	if (!ret) {
		/*
		 * The new worker reads the parent's memory, so this cannot
		 * be interrupted: a COPY source must stay stable until then.
		 */
		wait_for_completion(&wait.done);
		ret = READ_ONCE(wait.status);
		ret = ret == 1 ? 0 : ret;
	}

	spin_lock_irqsave(&spawn_waits_lock, flags);
	list_del(&wait.node);
	spin_unlock_irqrestore(&spawn_waits_lock, flags);

	return ret;
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

	atomic_set(&task_thread_info(p)->running_cpu, WASM_CPU_PARKED);
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
	if (user_memory != WASM_USER_MEMORY_NONE)
		task_thread_info(p)->context_mm = p->mm;
	/*
	 * A thread's exec ends the other threads, which leaves this worker the
	 * only user of the memory; another process sharing it lives on.
	 */
	if (user_memory == WASM_USER_MEMORY_SHARE &&
	    !(args->flags & CLONE_THREAD))
		task_thread_info(p)->borrowed_user_memory = true;

	/*
	 * A copy must not race a foreign write, such as a ptrace poke, into the
	 * memory being snapshotted. Holding the mm's remote-access mutex keeps
	 * any request from being published until the copy is complete.
	 */
	if (user_memory == WASM_USER_MEMORY_COPY) {
		mutex_lock(&current->mm->context.remote.mutex);
		ret = wasm_spawn_worker_wait(&task_entry, bootstrap_args, name,
					     name_len, user_memory);
		mutex_unlock(&current->mm->context.remote.mutex);
	} else {
		ret = wasm_kernel_spawn_worker(&task_entry, bootstrap_args,
					       name, name_len, user_memory,
					       NULL);
	}
	if (ret) {
		kfree(bootstrap_args);
		return ret;
	}

	return 0;
}
