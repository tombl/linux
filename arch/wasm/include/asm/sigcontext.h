#ifndef _WASM_SIGCONTEXT_H
#define _WASM_SIGCONTEXT_H

struct pt_regs {
	int (*fn)(void*);
	void* fn_arg;
	struct task_struct* prev;
};

struct sigcontext {
	struct pt_regs regs;
};

#endif
