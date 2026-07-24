/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _ASM_WASM_FUTEX_H
#define _ASM_WASM_FUTEX_H

#include <linux/errno.h>
#include <linux/futex.h>
#include <linux/uaccess.h>

#include <asm/wasm_imports.h>

static inline int arch_futex_atomic_op_inuser(int op, int oparg, int *oval,
					      u32 __user *uaddr)
{
	if (!access_ok(uaddr, sizeof(*uaddr)))
		return -EFAULT;

	return wasm_user_futex_atomic_op(oval, uaddr, op, oparg);
}

static inline int futex_atomic_cmpxchg_inatomic(u32 *uval,
						u32 __user *uaddr,
						u32 oldval, u32 newval)
{
	if (!access_ok(uaddr, sizeof(*uaddr)))
		return -EFAULT;

	return wasm_user_futex_atomic_cmpxchg(uval, uaddr, oldval, newval);
}

#endif
