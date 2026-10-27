#include <asm/wasm_imports.h>
#include <linux/mm_types.h>
#include <linux/rcupdate.h>
#include <linux/sched/signal.h>
#include <linux/syscalls.h>

struct clone_fn {
	void *__user fn;
	void *__user arg;
};

int wasm_call_clone_fn(void *arg)
{
	struct clone_fn *clone_fn = arg;
	wasm_user_switch_entry((uintptr_t)clone_fn->fn,
			       (uintptr_t)clone_fn->arg);
	kfree(clone_fn);
	return 0;
}

/*
 * Whether a task other than current runs in @mm. mm_users alone cannot tell:
 * it also counts short-lived references, such as the one a /proc reader
 * takes, which run no code in the memory. Only a task already in @mm can add
 * another, so once current is alone it stays alone for this clone.
 */
static bool wasm_mm_shared(struct mm_struct *mm)
{
	struct task_struct *group, *task;
	bool shared = false;

	if (atomic_read(&mm->mm_users) == 1)
		return false;

	rcu_read_lock();
	for_each_process_thread(group, task) {
		struct mm_struct *task_mm = READ_ONCE(task->mm);

		if (task != current && task_mm == mm) {
			shared = true;
			break;
		}
		/*
		 * As in current_is_single_threaded(): a task that has left
		 * its mm may have cloned into ours first. Make sure the rest
		 * of the walk sees that child.
		 */
		if (!task_mm)
			smp_rmb();
	}
	rcu_read_unlock();

	return shared;
}

SYSCALL_DEFINE6(clone, void *__user, fn, void *__user, fn_arg, unsigned long,
		clone_flags, int __user *, parent_tidptr, int __user *,
		child_tidptr, unsigned long, tls)
{
	struct kernel_clone_args kargs;
	struct clone_fn *clone_fn;
	long ret;

	/*
	 * Copying WebAssembly memory is synchronous, but there is no way to
	 * stop other workers while taking the snapshot.  Refuse to produce an
	 * incoherent address space when another task shares this one.
	 */
	if (!(clone_flags & CLONE_VM) && wasm_mm_shared(current->mm))
		return -EOPNOTSUPP;

	kargs = (struct kernel_clone_args) {
		.flags = (lower_32_bits(clone_flags) & ~CSIGNAL),
		.pidfd = parent_tidptr,
		.child_tid = child_tidptr,
		.parent_tid = parent_tidptr,
		.exit_signal = (lower_32_bits(clone_flags) & CSIGNAL),
		.tls = tls,
	};

	clone_fn = kmalloc(sizeof(*clone_fn), GFP_KERNEL);
	if (!clone_fn)
		return -ENOMEM;
	clone_fn->fn = fn;
	clone_fn->arg = fn_arg;

	kargs.fn = wasm_call_clone_fn;
	kargs.fn_arg = clone_fn;

	ret = kernel_clone(&kargs);
	if (ret < 0)
		kfree(clone_fn);

	return ret;
}
