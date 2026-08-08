/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _ASM_WASM_SPINLOCK_TYPES_H
#define _ASM_WASM_SPINLOCK_TYPES_H

#ifndef __LINUX_SPINLOCK_TYPES_RAW_H
#error "Please do not include this file directly."
#endif

#include <linux/types.h>

/*
 * Keep every concurrently accessed field in its own 32-bit word.  Wasm only
 * guarantees sequential consistency between atomic accesses to identical
 * byte ranges, so packed ticket or queued locks are not suitable here.
 */
typedef struct {
	u32 owner;
	u32 next;
} arch_spinlock_t;

#define __ARCH_SPIN_LOCK_UNLOCKED	{ .owner = 0, .next = 0 }

typedef struct {
	u32 readers;
	u32 writer_owner;
	u32 writer_next;
} arch_rwlock_t;

#define __ARCH_RW_LOCK_UNLOCKED					\
	{ .readers = 0, .writer_owner = 0, .writer_next = 0 }

#endif /* _ASM_WASM_SPINLOCK_TYPES_H */
