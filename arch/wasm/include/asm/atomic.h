#ifndef _WASM_ATOMIC_H
#define _WASM_ATOMIC_H

#include <asm/cmpxchg.h>

#define arch_atomic_read(v)		__atomic_load_n(&((v)->counter), __ATOMIC_SEQ_CST)
#define arch_atomic_set(v, i)		__atomic_store_n(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic_cmpxchg(v, old, new)	arch_cmpxchg(&((v)->counter), old, new)
#define arch_atomic_xchg(v, new)		arch_xchg(&((v)->counter), new)

#define arch_atomic_fetch_add(i, v)	__atomic_fetch_add(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_add(i, v)		__atomic_add_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_add_return(i, v)	__atomic_add_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic_fetch_sub(i, v)	__atomic_fetch_sub(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_sub(i, v)		__atomic_sub_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_sub_return(i, v)	__atomic_sub_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic_fetch_and(i, v)	__atomic_fetch_and(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_and(i, v)		__atomic_and_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_and_return(i, v)	__atomic_and_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic_fetch_xor(i, v)	__atomic_fetch_xor(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_xor(i, v)		__atomic_xor_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_xor_return(i, v)	__atomic_xor_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic_fetch_or(i, v)	__atomic_fetch_or(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_or(i, v)		__atomic_or_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic_or_return(i, v)	__atomic_or_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

typedef struct {
	s64 counter;
} atomic64_t;
#define ATOMIC64_INIT(i) { (i) }

#define arch_atomic64_read(v)		__atomic_load_n(&((v)->counter), __ATOMIC_SEQ_CST)
#define arch_atomic64_set(v, i)		__atomic_store_n(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic64_cmpxchg(v, old, new)	arch_cmpxchg(&((v)->counter), old, new)
#define arch_atomic64_xchg(v, new)		arch_xchg(&((v)->counter), new)

#define arch_atomic64_fetch_add(i, v)	__atomic_fetch_add(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_add(i, v)		__atomic_add_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_add_return(i, v)	__atomic_add_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic64_fetch_sub(i, v)	__atomic_fetch_sub(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_sub(i, v)		__atomic_sub_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_sub_return(i, v)	__atomic_sub_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic64_fetch_and(i, v)	__atomic_fetch_and(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_and(i, v)		__atomic_and_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_and_return(i, v)	__atomic_and_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic64_fetch_xor(i, v)	__atomic_fetch_xor(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_xor(i, v)		__atomic_xor_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_xor_return(i, v)	__atomic_xor_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

#define arch_atomic64_fetch_or(i, v)	__atomic_fetch_or(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_or(i, v)		__atomic_or_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)
#define arch_atomic64_or_return(i, v)	__atomic_or_fetch(&((v)->counter), (i), __ATOMIC_SEQ_CST)

// TODO(wasm): support other orderings

#endif
