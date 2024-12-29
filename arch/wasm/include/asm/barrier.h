#ifndef _WASM_BARRIER_H
#define _WASM_BARRIER_H

#define __smp_mb() __atomic_thread_fence(__ATOMIC_SEQ_CST)
#define __smp_rmb() __atomic_thread_fence(__ATOMIC_ACQ_REL)
#define __smp_wmb() __atomic_thread_fence(__ATOMIC_ACQ_REL)

#include <asm-generic/barrier.h>

#endif
