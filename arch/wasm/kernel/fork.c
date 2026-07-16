#include <asm/wasm_imports.h>
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

SYSCALL_DEFINE6(clone, void *__user, fn, void *__user, fn_arg, unsigned long,
		clone_flags, int __user *, parent_tidptr, int __user *,
		child_tidptr, unsigned long, tls)
{
	struct kernel_clone_args kargs;
	struct clone_fn *clone_fn;

	if (!(clone_flags & CLONE_VM))
		return -EINVAL;

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

	return kernel_clone(&kargs);
}
