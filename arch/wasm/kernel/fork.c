#include <asm/wasm_imports.h>
#include <linux/syscalls.h>

// int call_clone_fn(void *arg __user)
// {
// 	return -1;
// }

// static int worker_entry(void *arg)
// {
// 	return -1;

// }

SYSCALL_DEFINE6(clone, uintptr_t, fn, void *__user, fn_arg, unsigned long,
		clone_flags, int __user *, parent_tidptr, int __user *,
		child_tidptr, unsigned long, tls)
{
	pr_info("in clone_fn: %lu\n", fn);

	struct kernel_clone_args kargs = {
		.flags = (lower_32_bits(clone_flags) & ~CSIGNAL),
		.pidfd = parent_tidptr,
		.child_tid = child_tidptr,
		.parent_tid = parent_tidptr,
		.exit_signal = (lower_32_bits(clone_flags) & CSIGNAL),
		.tls = tls,
	};

	// if these are defined then the fn branch in copy_thread
	// will go the wrong way
	// kargs.fn = call_clone_fn;
	// kargs.fn_arg = fn_arg;

	return kernel_clone(&kargs);
}
