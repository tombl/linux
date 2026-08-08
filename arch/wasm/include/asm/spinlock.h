/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _ASM_WASM_SPINLOCK_H
#define _ASM_WASM_SPINLOCK_H

#include <linux/limits.h>
#include <linux/types.h>

#include <asm/barrier.h>

static __always_inline u32 wasm_lock_load(const u32 *word)
{
	return __atomic_load_n(word, __ATOMIC_SEQ_CST);
}

static __always_inline void wasm_lock_wait(u32 *word, u32 value)
{
	__builtin_wasm_memory_atomic_wait32((int *)word, value, -1);
}

static __always_inline void wasm_lock_wake_all(u32 *word)
{
	__builtin_wasm_memory_atomic_notify((int *)word, INT_MAX);
}

static __always_inline int arch_spin_is_locked(arch_spinlock_t *lock)
{
	return wasm_lock_load(&lock->owner) != wasm_lock_load(&lock->next);
}

static __always_inline int arch_spin_value_unlocked(arch_spinlock_t lock)
{
	return lock.owner == lock.next;
}

static __always_inline int arch_spin_is_contended(arch_spinlock_t *lock)
{
	u32 owner = wasm_lock_load(&lock->owner);
	u32 next = wasm_lock_load(&lock->next);

	return (u32)(next - owner) > 1;
}
#define arch_spin_is_contended arch_spin_is_contended

static __always_inline void arch_spin_lock(arch_spinlock_t *lock)
{
	u32 ticket = __atomic_fetch_add(&lock->next, 1, __ATOMIC_SEQ_CST);
	u32 owner;

	while ((owner = wasm_lock_load(&lock->owner)) != ticket)
		wasm_lock_wait(&lock->owner, owner);
}

static __always_inline int arch_spin_trylock(arch_spinlock_t *lock)
{
	u32 owner = wasm_lock_load(&lock->owner);
	u32 next = wasm_lock_load(&lock->next);

	if (owner != next)
		return 0;

	return __atomic_compare_exchange_n(&lock->next, &next, next + 1,
					   false, __ATOMIC_SEQ_CST,
					   __ATOMIC_SEQ_CST);
}

static __always_inline void arch_spin_unlock(arch_spinlock_t *lock)
{
	__atomic_fetch_add(&lock->owner, 1, __ATOMIC_SEQ_CST);
	wasm_lock_wake_all(&lock->owner);
}

static __always_inline void arch_read_lock(arch_rwlock_t *lock)
{
	for (;;) {
		u32 owner = wasm_lock_load(&lock->writer_owner);

		if (owner != wasm_lock_load(&lock->writer_next)) {
			wasm_lock_wait(&lock->writer_owner, owner);
			continue;
		}

		__atomic_fetch_add(&lock->readers, 1, __ATOMIC_SEQ_CST);
		if (wasm_lock_load(&lock->writer_owner) ==
		    wasm_lock_load(&lock->writer_next))
			return;

		if (__atomic_fetch_sub(&lock->readers, 1,
					       __ATOMIC_SEQ_CST) == 1)
			wasm_lock_wake_all(&lock->readers);
	}
}

static __always_inline int arch_read_trylock(arch_rwlock_t *lock)
{
	if (wasm_lock_load(&lock->writer_owner) !=
	    wasm_lock_load(&lock->writer_next))
		return 0;

	__atomic_fetch_add(&lock->readers, 1, __ATOMIC_SEQ_CST);
	if (wasm_lock_load(&lock->writer_owner) ==
	    wasm_lock_load(&lock->writer_next))
		return 1;

	if (__atomic_fetch_sub(&lock->readers, 1, __ATOMIC_SEQ_CST) == 1)
		wasm_lock_wake_all(&lock->readers);
	return 0;
}

static __always_inline void arch_read_unlock(arch_rwlock_t *lock)
{
	if (__atomic_fetch_sub(&lock->readers, 1, __ATOMIC_SEQ_CST) == 1)
		wasm_lock_wake_all(&lock->readers);
}

static __always_inline void arch_write_lock(arch_rwlock_t *lock)
{
	u32 ticket = __atomic_fetch_add(&lock->writer_next, 1,
					__ATOMIC_SEQ_CST);
	u32 value;

	while ((value = wasm_lock_load(&lock->writer_owner)) != ticket)
		wasm_lock_wait(&lock->writer_owner, value);

	while ((value = wasm_lock_load(&lock->readers)) != 0)
		wasm_lock_wait(&lock->readers, value);
}

static __always_inline int arch_write_trylock(arch_rwlock_t *lock)
{
	u32 owner = wasm_lock_load(&lock->writer_owner);
	u32 next = wasm_lock_load(&lock->writer_next);

	if (owner != next)
		return 0;

	if (!__atomic_compare_exchange_n(&lock->writer_next, &next, next + 1,
					 false, __ATOMIC_SEQ_CST,
					 __ATOMIC_SEQ_CST))
		return 0;

	if (wasm_lock_load(&lock->readers) == 0)
		return 1;

	__atomic_fetch_add(&lock->writer_owner, 1, __ATOMIC_SEQ_CST);
	wasm_lock_wake_all(&lock->writer_owner);
	return 0;
}

static __always_inline void arch_write_unlock(arch_rwlock_t *lock)
{
	__atomic_fetch_add(&lock->writer_owner, 1, __ATOMIC_SEQ_CST);
	wasm_lock_wake_all(&lock->writer_owner);
}

static __always_inline int arch_rwlock_is_contended(arch_rwlock_t *lock)
{
	return wasm_lock_load(&lock->writer_owner) !=
	       wasm_lock_load(&lock->writer_next);
}
#define arch_rwlock_is_contended arch_rwlock_is_contended

/* Upgrade the lock acquisition to the ordering required by the scheduler. */
#define smp_mb__after_spinlock()	smp_mb()

#endif /* _ASM_WASM_SPINLOCK_H */
