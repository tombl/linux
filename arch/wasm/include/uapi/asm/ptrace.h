#ifndef _WASM_PTRACE_H
#define _WASM_PTRACE_H

#include <asm/bug.h>
#include <linux/errno.h>

struct task_struct;

#define user_mode(regs) (__builtin_trap(),0)
#define kernel_mode(regs) (__builtin_trap(),0)
#define profile_pc(regs) (__builtin_trap(),0)
#define instruction_pointer(regs) (__builtin_trap(),0)
#define user_stack_pointer(regs) (__builtin_trap(),0)

static inline long arch_ptrace(struct task_struct *child, long request,
			       unsigned long addr, unsigned long data)
{
	BUG();
	return -EINVAL;
}

static inline void ptrace_disable(struct task_struct *child)
{
	BUG();
}

static inline int regs_irqs_disabled(struct pt_regs *regs)
{
	BUG();
	// return arch_irqs_disabled_flags(regs->SOMETHING);
}

#define PTRACE_SYSEMU		  31
#define PTRACE_SYSEMU_SINGLESTEP  32

#endif
