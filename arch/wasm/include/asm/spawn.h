/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef _WASM_SPAWN_H
#define _WASM_SPAWN_H

#include <asm/wasm_imports.h>
#include <linux/completion.h>
#include <linux/list.h>
#include <linux/types.h>

/*
 * A spawn whose result comes from the new worker. From that worker, the host
 * stores status (1 on success, or a negative errno), then raises irq. The
 * layout of the first two fields is part of the spawn_worker import ABI.
 */
struct wasm_spawn_wait {
	s32 status;
	u32 irq;
	struct completion done;
	struct list_head node;
};

int wasm_spawn_worker_wait(void (*fn)(void *), void *arg, char *name,
			   size_t name_len, enum wasm_user_memory user_memory);

#endif
