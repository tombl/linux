#ifndef _WASM_SYSCALL_H
#define _WASM_SYSCALL_H

#include <asm-generic/syscalls.h>
#include <asm/bug.h>
#include <asm/ptrace.h>

static inline long syscall_get_nr(struct task_struct *task,
				  struct pt_regs *regs)
{
	BUG();
}

static inline int syscall_get_arch(struct task_struct *task)
{
	BUG();
}

#endif
