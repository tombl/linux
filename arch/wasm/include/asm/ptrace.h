#ifndef _ASM_WASM_PTRACE_H
#define _ASM_WASM_PTRACE_H

#include <asm/bug.h>
#include <linux/errno.h>
#include <uapi/asm/ptrace.h>

struct task_struct;

#define user_mode(regs) (regs->user_mode)
#define instruction_pointer(regs) (-1)
#define user_stack_pointer(regs) (__builtin_trap(),0)

static inline int regs_irqs_disabled(struct pt_regs *regs)
{
	BUG();
	// return arch_irqs_disabled_flags(regs->SOMETHING);
}

#endif
