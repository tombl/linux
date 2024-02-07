#ifndef _WASM_SIGCONTEXT_H
#define _WASM_SIGCONTEXT_H

struct pt_regs {};

struct sigcontext {
	struct pt_regs regs;
};

#endif
