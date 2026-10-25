/* SPDX-License-Identifier: GPL-2.0 WITH Linux-syscall-note */
#ifndef __ASM_WASM_SIGNAL_H
#define __ASM_WASM_SIGNAL_H

#define SA_RESTORER	0x04000000

/*
 * WebAssembly cannot redirect an interrupted program counter, so a handler
 * cannot move a thread out of a blocked cancellation point the way libc does
 * natively. A handler installed with SA_WASM_CANCEL makes the syscall it
 * interrupts return -EINTR instead of restarting, but only when that syscall
 * was issued with __WASM_SYSCALL_CP. Other syscalls keep SA_RESTART.
 */
#define SA_WASM_CANCEL	0x00001000

#include <asm-generic/signal.h>

#endif /* __ASM_WASM_SIGNAL_H */
