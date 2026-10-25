#ifndef _WASM_WASM_IMPORTS_H
#define _WASM_WASM_IMPORTS_H

#include <linux/types.h>

#define wasm_import(ns, name)                                   \
	__attribute__((import_module(#ns), import_name(#name))) \
	wasm_##ns##_##name

size_t wasm_import(boot, get_devicetree)(char *buf, size_t size);
int wasm_import(boot, get_initramfs)(char *buf, size_t size);

void wasm_import(kernel, breakpoint)(void);
void wasm_import(kernel, halt_worker)(void);

/* Whole-machine lifecycle event. Values are part of the guest/host ABI. */
enum wasm_machine_termination_reason {
	WASM_MACHINE_TERMINATION_CLEAN = 0,
	WASM_MACHINE_TERMINATION_PANIC = 1,
};

void wasm_import(kernel, terminate_machine)(
	enum wasm_machine_termination_reason reason);

void wasm_import(kernel, boot_console_write)(const char *msg, size_t len);
void wasm_import(kernel, boot_console_close)(void);

void *wasm_import(kernel, return_address)(int level);

/* Unix time in nanoseconds, monotonically advancing during the host session. */
unsigned long long wasm_import(kernel, get_now_nsec)(void);

void wasm_import(kernel, get_stacktrace)(char *buf, size_t size);

enum wasm_user_memory {
	WASM_USER_MEMORY_NONE = 0,
	WASM_USER_MEMORY_SHARE = 1,
	WASM_USER_MEMORY_COPY = 2,
	WASM_USER_MEMORY_EXEC = 3,
};

/*
 * WASM_USER_MEMORY_COPY is synchronous: success means the destination worker
 * has completed its private snapshot; allocation failure returns -ENOMEM.
 *
 * WASM_USER_MEMORY_EXEC spawns the successor of the calling worker, which
 * hosts the image from the last successful compile_end. It is synchronous
 * too: success means the successor has allocated the image's memory and
 * instantiated it, and is waiting for user_exec_handoff() before it calls
 * fn(arg). compile_abort() ends a successor that never received the handoff.
 */
int wasm_import(kernel, spawn_worker)(void (*fn)(void *), void *arg,
				      char *name, size_t name_len,
				      enum wasm_user_memory user_memory);

void wasm_import(kernel, run_on_main)(void (*fn)(void *), void *arg);

int wasm_import(user, compile_begin)(u32 len);
int wasm_import(user, compile_write)(u8 *bytes, u32 offset, u32 len);
int wasm_import(user, compile_end)(u32 maximum_memory_pages);
void wasm_import(user, compile_abort)(void);
/* Lets the exec successor run, then ends this worker. */
void wasm_import(user, exec_handoff)(void) __attribute__((noreturn));
void wasm_import(user, call)(void);
void wasm_import(user, switch_entry)(uintptr_t fn, uintptr_t arg);
/*
 * A signal handler escapes when it leaves through a wasm exception, such as
 * siglongjmp() or a C++ throw, instead of returning. The host holds the
 * exception and user.rethrow throws it once the delivering syscall has
 * returned through the kernel. A siginfo handler otherwise reports the
 * result of its siginfo copy, which is negative if it failed.
 */
enum wasm_handler_result {
	WASM_HANDLER_RETURNED = 0,
	WASM_HANDLER_ESCAPED = 1,
};

int wasm_import(user, call_signal_handler)(uintptr_t fn, u32 sig);
int wasm_import(user, call_siginfo_handler)(uintptr_t trampoline, uintptr_t fn,
					    u32 sig);
/* Throws the exception a handler escaped with. Never returns. */
void __noreturn wasm_import(user, rethrow)(void);
void wasm_import(user, halt_signal_handler)(void);

int wasm_import(user, read)(void *to, const void __user *from, unsigned long n);
int wasm_import(user, write)(void __user *to, const void *from, unsigned long n);
int wasm_import(user, write_zeroes)(void __user *to, unsigned long n);
int wasm_import(user, futex_atomic_op)(int *oldval, u32 __user *uaddr,
				       int op, int oparg);
int wasm_import(user, futex_atomic_cmpxchg)(u32 *oldval, u32 __user *uaddr,
					    u32 expected, u32 replacement);

#ifdef CONFIG_VIRTIO_WASM
void wasm_import(virtio, set_features)(u32 id, u64 features);

void wasm_import(virtio, setup)(u32 id, u32 config_irq, u8 *config,
				u32 config_len);
void wasm_import(virtio, reset)(u32 id, u32 *done);

void wasm_import(virtio, enable_vring)(u32 id, u32 index, u32 size,
				       dma_addr_t desc, u32 irq);
void wasm_import(virtio, disable_vring)(u32 id, u32 index);

void wasm_import(virtio, notify)(u32 id, u32 index);
#endif

#undef wasm_import

#endif
