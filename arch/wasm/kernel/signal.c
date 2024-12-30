#include <linux/syscalls.h>

SYSCALL_DEFINE0(rt_sigreturn)
{
	current->restart_block.fn = do_no_restart_syscall;

	// this will likely require sjlj or some other exception based control flow

	BUG();
}