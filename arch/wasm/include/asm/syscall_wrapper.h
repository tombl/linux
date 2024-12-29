#ifndef _WASM_SYSCALL_WRAPPER_H
#define _WASM_SYSCALL_WRAPPER_H

#include <asm/ptrace.h>

#define SC_WASM_REGS_TO_ARGS(x, ...)                                          \
	__MAP(x, __SC_ARGS, , regs->syscall_args[0], , regs->syscall_args[1], \
	      , regs->syscall_args[2], , regs->syscall_args[3], ,             \
	      regs->syscall_args[4], , regs->syscall_args[5])

#define __SYSCALL_DEFINEx(x, name, ...)                                      \
	asmlinkage long sys##name(const struct pt_regs *regs);               \
	ALLOW_ERROR_INJECTION(sys##name, ERRNO);                             \
	static long __se_sys##name(__MAP(x, __SC_LONG, __VA_ARGS__));        \
	static inline long __do_sys##name(__MAP(x, __SC_DECL, __VA_ARGS__)); \
	asmlinkage long sys##name(const struct pt_regs *regs)                \
	{                                                                    \
		return __se_sys##name(SC_WASM_REGS_TO_ARGS(x, __VA_ARGS__)); \
	}                                                                    \
	static long __se_sys##name(__MAP(x, __SC_LONG, __VA_ARGS__))         \
	{                                                                    \
		long ret = __do_sys##name(__MAP(x, __SC_CAST, __VA_ARGS__)); \
		__MAP(x, __SC_TEST, __VA_ARGS__);                            \
		__PROTECT(x, ret, __MAP(x, __SC_ARGS, __VA_ARGS__));         \
		return ret;                                                  \
	}                                                                    \
	static inline long __do_sys##name(__MAP(x, __SC_DECL, __VA_ARGS__))

#define SYSCALL_DEFINE0(sname)                                       \
	SYSCALL_METADATA(_##sname, 0);                               \
	asmlinkage long sys_##sname(const struct pt_regs *__unused); \
	ALLOW_ERROR_INJECTION(sys_##sname, ERRNO);                   \
	asmlinkage long sys_##sname(const struct pt_regs *__unused)

#define SYS_NI(name) SYSCALL_ALIAS(sys_##name, sys_ni_posix_timers);

#endif
