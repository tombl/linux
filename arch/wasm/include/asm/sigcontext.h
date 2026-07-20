#ifndef _WASM_SIGCONTEXT_H
#define _WASM_SIGCONTEXT_H

struct pt_regs {
	long syscall_nr;
	unsigned long syscall_args[6];
	long syscall_return;
	long restart_syscall_nr;
	int user_mode;
};

struct sigcontext {
	struct pt_regs regs;
};

#endif
