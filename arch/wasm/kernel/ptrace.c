#include <linux/ptrace.h>

void show_regs(struct pt_regs *fp)
{
	pr_info("syscall=%ld args=%#lx,%#lx,%#lx,%#lx,%#lx,%#lx user=%d\n",
		fp->syscall_nr, fp->syscall_args[0], fp->syscall_args[1],
		fp->syscall_args[2], fp->syscall_args[3], fp->syscall_args[4],
		fp->syscall_args[5], fp->user_mode);
}
