/* SPDX-License-Identifier: GPL-2.0 */
#ifndef _WASM_MMU_H
#define _WASM_MMU_H

#ifndef __ASSEMBLY__

#include <linux/types.h>

/*
 * Same layout as the asm-generic nommu mm_context_t, plus a kernel-side
 * copy of the process command line.
 *
 * binfmt_wasm hands argv/envp to userland through a flat blob fetched via
 * the get_args() export instead of laying them out on a user stack, and
 * wasm user memory is a separate per-process linear memory that the
 * kernel can only reach through host imports acting on the current task.
 * access_remote_vm() therefore cannot read a foreign process's argv
 * strings, so /proc/<pid>/cmdline is served from this copy instead.
 */
typedef struct {
	unsigned long		end_brk;

#ifdef CONFIG_BINFMT_ELF_FDPIC
	unsigned long		exec_fdpic_loadmap;
	unsigned long		interp_fdpic_loadmap;
#endif

	/* NUL-separated argv strings, saved at exec time; NULL for kthreads */
	char			*cmdline;
	size_t			cmdline_len;
} mm_context_t;

#endif /* !__ASSEMBLY__ */

#endif /* _WASM_MMU_H */
