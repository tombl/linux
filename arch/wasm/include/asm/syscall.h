#ifndef _WASM_SYSCALL_H
#define _WASM_SYSCALL_H

#include <linux/audit.h>
#include <asm/syscalls.h>
#include <asm/bug.h>
#include <asm/ptrace.h>
#include <asm/sigcontext.h>

static inline long syscall_get_nr(struct task_struct *task,
				  struct pt_regs *regs)
{
	return regs->syscall_nr;
}

static inline int syscall_get_arch(struct task_struct *task)
{
	// TODO
	return 0;
}

static inline bool arch_syscall_is_vdso_sigreturn(struct pt_regs *regs)
{
	// TODO
	return false;
}

static inline void syscall_get_arguments(struct task_struct *task,
					 struct pt_regs *regs,
					 unsigned long *args)
{
	memcpy(args, &regs->syscall_args, sizeof(regs->syscall_args));
}

static inline long syscall_get_return_value(struct task_struct *task,
					    struct pt_regs *regs)
{
	return regs->syscall_return;
}

static inline long syscall_get_error(struct task_struct *task,
				     struct pt_regs *regs)
{
	return IS_ERR_VALUE(regs->syscall_return) ? regs->syscall_return : 0;
}

static inline void syscall_set_return_value(struct task_struct *task,
					    struct pt_regs *regs,
					    int error, long val)
{
	regs->syscall_return = error ?: val;
}

static inline void syscall_rollback(struct task_struct *task,
				    struct pt_regs *regs)
{
	regs->syscall_return = regs->syscall_nr;
}

#endif
