/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _WASM_MMU_H
#define _WASM_MMU_H

#ifndef __ASSEMBLY__

#include <linux/atomic.h>
#include <linux/mutex.h>

struct wasm_exec_args;
struct wasm_remote_request;

enum wasm_remote_state {
	WASM_REMOTE_IDLE,
	WASM_REMOTE_PUBLISHED,
	WASM_REMOTE_CLAIMED,
	WASM_REMOTE_DONE,
};

struct wasm_remote_slot {
	struct mutex mutex;
	atomic_t state;
	struct wasm_remote_request *request;
	bool accepting;
};

typedef struct {
	unsigned long end_brk;

#ifdef CONFIG_BINFMT_ELF_FDPIC
	unsigned long exec_fdpic_loadmap;
	unsigned long interp_fdpic_loadmap;
#endif

	/*
	 * Foreign access is serialized per mm. The request payload belongs to
	 * the requester; state and request publication are protected by the
	 * ordering documented in arch/wasm/kernel/remote_vm.c.
	 */
	struct wasm_remote_slot remote;

	/* Owned by the new mm between exec and the userspace startup call. */
	struct wasm_exec_args *exec_args;
} mm_context_t;

#endif /* !__ASSEMBLY__ */

#endif /* _WASM_MMU_H */
