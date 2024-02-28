#ifndef _WASM_SIGCONTEXT_H
#define _WASM_SIGCONTEXT_H

struct pt_regs {
	void* current_stack;
	int (*fn)(void*);
	void* fn_arg;
};

struct sigcontext {
	struct pt_regs regs;
};

#endif
