#include <linux/ptrace.h>

void show_regs(struct pt_regs *fp)
{
	pr_info("syscall=%ld args=%#lx,%#lx,%#lx,%#lx,%#lx,%#lx user=%d\n",
		fp->syscall_nr, fp->syscall_args[0], fp->syscall_args[1],
		fp->syscall_args[2], fp->syscall_args[3], fp->syscall_args[4],
		fp->syscall_args[5], fp->user_mode);
}

/*
 * The kernel cannot see a wasm task's user registers, so there are no
 * register requests. The generic ones, including memory peeks and pokes
 * through the tracee's worker, still apply.
 */
long arch_ptrace(struct task_struct *child, long request, unsigned long addr,
		 unsigned long data)
{
	return ptrace_request(child, request, addr, data);
}

/* There is no single-step or debug register state to clear on detach. */
void ptrace_disable(struct task_struct *child)
{
}
