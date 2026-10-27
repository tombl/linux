/* SPDX-License-Identifier: GPL-2.0 WITH Linux-syscall-note */
#ifndef _UAPI_ASM_WASM_PTRACE_H
#define _UAPI_ASM_WASM_PTRACE_H

/* struct pt_regs, the registers a syscall leaves in the kernel. */
#include <asm/sigcontext.h>

#define PTRACE_SYSEMU		  31
#define PTRACE_SYSEMU_SINGLESTEP  32

#endif
