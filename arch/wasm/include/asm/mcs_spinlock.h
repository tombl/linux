/* SPDX-License-Identifier: GPL-2.0 */
/*
 * MCS node handoff, realized as wait/notify.
 *
 * MCS is what keeps contended locks fair: waiters queue on their own node
 * word and the holder hands off to exactly the next waiter, FIFO. We keep
 * that handoff; only the wait changes.
 *
 * wasm has no pause, so "spinning" means sleeping on the irq summary, a
 * word the handoff never wakes — every handoff cost a full cpu_relax
 * timeout. Waiting on the node word and notifying on handoff is the only
 * prompt form, and the honest one: a spinlock realized as a futex. That is
 * appropriate here because the holder is always another worker, never
 * descheduled inside the critical section, so it always notifies; and
 * atomic.wait re-checks its value at entry, so no wakeup is lost. This
 * stays a spinlock-scope primitive — locks that want to sleep are mutexes.
 */
#ifndef _ASM_WASM_MCS_SPINLOCK_H
#define _ASM_WASM_MCS_SPINLOCK_H

#include <asm/barrier.h>

static __always_inline void wasm_mcs_spin_lock_contended(int *locked)
{
	while (!smp_load_acquire(locked))
		__builtin_wasm_memory_atomic_wait32(locked, 0, -1);
}

static __always_inline void wasm_mcs_spin_unlock_contended(int *locked)
{
	smp_store_release(locked, 1);
	__builtin_wasm_memory_atomic_notify(locked, 1);
}

#define arch_mcs_spin_lock_contended(l)	wasm_mcs_spin_lock_contended(l)
#define arch_mcs_spin_unlock_contended(l)	wasm_mcs_spin_unlock_contended(l)

#endif /* _ASM_WASM_MCS_SPINLOCK_H */
