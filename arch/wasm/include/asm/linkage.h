#ifndef _WASM_LINKAGE_H
#define _WASM_LINKAGE_H

#define SYSCALL_ALIAS(alias, name)                               \
	asmlinkage long name(const struct pt_regs *regs);        \
	asmlinkage long __weak alias(const struct pt_regs *regs) \
	{                                                        \
		return name(regs);                               \
	}

#define cond_syscall(x) SYSCALL_ALIAS(x, sys_ni_syscall)

#define _THIS_IP_ (unsigned long)__builtin_return_address(-1)

#endif
