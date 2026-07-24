/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef _ASM_WASM_SWITCH_TO_H
#define _ASM_WASM_SWITCH_TO_H

#include <asm/globals.h>
#include <asm-generic/switch_to.h>

#define arch_task_dead()	wasm_set_thread_done(true)

#endif
