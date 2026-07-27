/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _WASM_MMU_H
#define _WASM_MMU_H

#ifndef __ASSEMBLY__

struct wasm_exec_args;

typedef struct {
	unsigned long end_brk;

#ifdef CONFIG_BINFMT_ELF_FDPIC
	unsigned long exec_fdpic_loadmap;
	unsigned long interp_fdpic_loadmap;
#endif

	/* Owned by the new mm between exec and the userspace startup call. */
	struct wasm_exec_args *exec_args;
} mm_context_t;

#endif /* !__ASSEMBLY__ */

#endif /* _WASM_MMU_H */
