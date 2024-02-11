#ifndef _WASM_CMPXCHG_H
#define _WASM_CMPXCHG_H

#include <linux/types.h>

static inline unsigned long __arch_xchg(unsigned long x, volatile void *ptr,
					int size, int order)
{
	switch (size) {
	case 1:
		return __atomic_exchange_n((volatile u8 *)ptr, x & 0xffu,
					   order);
	case 2:
		return __atomic_exchange_n((volatile u16 *)ptr, x & 0xffffu,
					   order);
	case 4:
		return __atomic_exchange_n((volatile u32 *)ptr, x & 0xffffffffu,
					   order);
#ifdef CONFIG_64BIT
	case 8:
		return __atomic_exchange_n((volatile u64 *)ptr, x, order);
#endif
	default:
		__builtin_trap();
	}
}

#define arch_xchg(ptr, x)                                           \
	((__typeof__(*(ptr)))__arch_xchg((unsigned long)(x), (ptr), \
					 sizeof(*(ptr)), __ATOMIC_SEQ_CST))
#define arch_xchg_relaxed(ptr, x)                                   \
	((__typeof__(*(ptr)))__arch_xchg((unsigned long)(x), (ptr), \
					 sizeof(*(ptr)), __ATOMIC_RELAXED))
#define arch_xchg_acquire(ptr, x)                                   \
	((__typeof__(*(ptr)))__arch_xchg((unsigned long)(x), (ptr), \
					 sizeof(*(ptr)), __ATOMIC_ACQUIRE))
#define arch_xchg_release(ptr, x)                                   \
	((__typeof__(*(ptr)))__arch_xchg((unsigned long)(x), (ptr), \
					 sizeof(*(ptr)), __ATOMIC_RELEASE))

static inline unsigned long __arch_cmpxchg(volatile void *ptr,
					   unsigned long old, unsigned long new,
					   int size, int order)
{
	switch (size) {
	case 1:
		return __atomic_compare_exchange_n((volatile u8 *)ptr,
						   (u8 *)&old, new & 0xffu, 0,
						   order, __ATOMIC_SEQ_CST) ?
			       old :
			       new;
	case 2:
		return __atomic_compare_exchange_n((volatile u16 *)ptr,
						   (u16 *)&old, new & 0xffffu,
						   0, order, __ATOMIC_SEQ_CST) ?
			       old :
			       new;
	case 4:
		return __atomic_compare_exchange_n((volatile u32 *)ptr,
						   (u32 *)&old,
						   new & 0xffffffffu, 0, order,
						   __ATOMIC_SEQ_CST) ?
			       old :
			       new;
#ifdef CONFIG_64BIT
	case 8:
		return __atomic_compare_exchange_n((volatile u64 *)ptr,
						   (u64 *)&old, new, 0, order,
						   __ATOMIC_SEQ_CST)
#endif
			default : __builtin_trap();
	}
}

#define arch_cmpxchg(ptr, old, new)                                      \
	((__typeof__(*(ptr)))__arch_cmpxchg((ptr), (unsigned long)(old), \
					    (unsigned long)(new),        \
					    sizeof(*(ptr)), __ATOMIC_SEQ_CST))
#define arch_cmpxchg_relaxed(ptr, old, new)                              \
	((__typeof__(*(ptr)))__arch_cmpxchg((ptr), (unsigned long)(old), \
					    (unsigned long)(new),        \
					    sizeof(*(ptr)), __ATOMIC_RELAXED))
#define arch_cmpxchg_acquire(ptr, old, new)                              \
	((__typeof__(*(ptr)))__arch_cmpxchg((ptr), (unsigned long)(old), \
					    (unsigned long)(new),        \
					    sizeof(*(ptr)), __ATOMIC_ACQUIRE))
#define arch_cmpxchg_release(ptr, old, new)                              \
	((__typeof__(*(ptr)))__arch_cmpxchg((ptr), (unsigned long)(old), \
					    (unsigned long)(new),        \
					    sizeof(*(ptr)), __ATOMIC_RELEASE))

#endif