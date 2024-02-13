#ifndef _WASM_PERCPU_H
#define _WASM_PERCPU_H

#ifdef CONFIG_SMP
#define PER_CPU_ATTRIBUTES _Thread_local
#endif

#include <asm-generic/percpu.h>

#endif
