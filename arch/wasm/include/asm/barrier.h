#ifndef _WASM_BARRIER_H
#define _WASM_BARRIER_H

#define __smp_mb() __atomic_thread_fence(__ATOMIC_SEQ_CST)
#define __smp_rmb() __atomic_thread_fence(__ATOMIC_ACQ_REL)
#define __smp_wmb() __atomic_thread_fence(__ATOMIC_ACQ_REL)

#define __wasm_atomic_ptr(p)						\
	((typeof(p))__builtin_assume_aligned((const void *)(p), sizeof(*(p))))

/*
 * A fence does not make an adjacent plain Wasm memory access atomic.  Use an
 * atomic instruction for the access itself so that release/acquire pairs
 * synchronize through shared linear memory.
 */
#define __smp_store_release(p, v)					\
do {									\
	compiletime_assert_atomic_type(*(p));				\
	__atomic_store_n(__wasm_atomic_ptr(p), (v), __ATOMIC_RELEASE);	\
} while (0)

#define __smp_load_acquire(p)						\
({									\
	__unqual_scalar_typeof(*(p)) __value;				\
	compiletime_assert_atomic_type(*(p));				\
	__value = __atomic_load_n(__wasm_atomic_ptr(p), __ATOMIC_ACQUIRE);\
	(typeof(*(p)))__value;						\
})

#define smp_cond_load_relaxed(ptr, cond_expr)				\
({									\
	typeof(ptr) __ptr = (ptr);					\
	__unqual_scalar_typeof(*(ptr)) VAL;				\
	for (;;) {							\
		VAL = __atomic_load_n(__wasm_atomic_ptr(__ptr),		\
				      __ATOMIC_RELAXED);			\
		if (cond_expr)						\
			break;						\
		cpu_relax();						\
	}								\
	(typeof(*(ptr)))VAL;						\
})

#define smp_cond_load_acquire(ptr, cond_expr)				\
({									\
	typeof(ptr) __ptr = (ptr);					\
	__unqual_scalar_typeof(*(ptr)) VAL;				\
	for (;;) {							\
		VAL = __atomic_load_n(__wasm_atomic_ptr(__ptr),		\
				      __ATOMIC_ACQUIRE);			\
		if (cond_expr)						\
			break;						\
		cpu_relax();						\
	}								\
	(typeof(*(ptr)))VAL;						\
})

#include <asm-generic/barrier.h>

#endif
