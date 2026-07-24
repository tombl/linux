// SPDX-License-Identifier: GPL-2.0

#include <linux/entry-common.h>

#ifdef CONFIG_HAVE_SYSCALL_TRACEPOINTS
#define CREATE_TRACE_POINTS
#include <trace/events/syscalls.h>
#endif

/* Out of line to prevent tracepoint code duplication */

long trace_syscall_enter(struct pt_regs *regs, long syscall)
{
#ifdef CONFIG_HAVE_SYSCALL_TRACEPOINTS
	trace_sys_enter(regs, syscall);
	/*
	 * Probes or BPF hooks in the tracepoint may have changed the
	 * system call number. Reread it.
	 */
	return syscall_get_nr(current, regs);
#else
	return syscall;
#endif
}

void trace_syscall_exit(struct pt_regs *regs, long ret)
{
#ifdef CONFIG_HAVE_SYSCALL_TRACEPOINTS
	trace_sys_exit(regs, ret);
#endif
}
