#ifndef _WASM_BUG_H
#define _WASM_BUG_H

#include <asm/wasm_imports.h>

#define HAVE_ARCH_BUG
#define BUG()                                                                \
	do {                                                                 \
		pr_crit("BUG: failure at %s:%d/%s()!\n", __FILE__, __LINE__, \
			__func__);                                           \
		wasm_breakpoint();                                           \
		barrier_before_unreachable();                                \
		__builtin_trap();                                            \
	} while (0)

#include <asm-generic/bug.h>

#endif