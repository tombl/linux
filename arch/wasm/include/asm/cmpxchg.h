#ifndef _WASM_CMPXCHG_H
#define _WASM_CMPXCHG_H

#include <asm/bug.h>
#include <linux/types.h>

#define arch_xchg(ptr, x) __atomic_exchange_n((ptr), (x), __ATOMIC_SEQ_CST)

#define arch_cmpxchg(ptr, old, new)                                      \
	({                                                               \
		typeof(*(ptr)) __old = (old), __new = (new);             \
		__atomic_compare_exchange_n((ptr), &__old, __new, false, \
					    __ATOMIC_SEQ_CST,            \
					    __ATOMIC_RELAXED);           \
		__old;                                                   \
	})

#endif