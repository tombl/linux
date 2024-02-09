#ifndef _WASM_TIMEX_H
#define _WASM_TIMEX_H

#include <asm/wasm_imports.h>

typedef unsigned long long cycles_t;
static inline cycles_t get_cycles(void)
{
	return wasm_get_now_nsec();
}

#define ARCH_HAS_READ_CURRENT_TIMER
static inline int read_current_timer(unsigned long *timer_val)
{
	__builtin_trap();
        *timer_val = wasm_get_now_nsec();
        return 0;
}

#endif