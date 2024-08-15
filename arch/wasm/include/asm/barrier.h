#ifndef _WASM_BARRIER_H
#define _WASM_BARRIER_H

#define __smp_mb() __atomic_thread_fence(__ATOMIC_SEQ_CST)
#define __smp_rmb() __atomic_thread_fence(__ATOMIC_ACQUIRE)
#define __smp_wmb() __atomic_thread_fence(__ATOMIC_RELEASE)

#include <asm-generic/barrier.h>

#endif