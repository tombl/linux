#ifndef _WASM_TIMEX_H
#define _WASM_TIMEX_H

#include <asm/wasm_imports.h>

typedef unsigned long long cycles_t;
static inline cycles_t get_cycles(void)
{
	return wasm_get_now_nsec();
}

#define jiffies (*(unsigned long *)(&jiffies_64))

#endif
