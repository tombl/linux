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
};

/*
 * WASM_USER_MEMORY_COPY is synchronous: success means the destination worker
 * has completed its private snapshot; allocation failure returns -ENOMEM.
 */
int wasm_import(kernel, spawn_worker)(void (*fn)(void *), void *arg,
				      char *name, size_t name_len,
				      enum wasm_user_memory user_memory);

void wasm_import(kernel, run_on_main)(void (*fn)(void *), void *arg);

int wasm_import(user, compile_begin)(u32 len);
int wasm_import(user, compile_write)(u8 *bytes, u32 offset, u32 len);
int wasm_import(user, compile_end)(u32 maximum_memory_pages);
void wasm_import(user, compile_abort)(void);
void wasm_import(user, instantiate)(bool fresh_memory);
void wasm_import(user, call)(void);
void wasm_import(user, switch_entry)(u32 fn, u32 arg);
void wasm_import(user, call_signal_handler)(u32 fn, u32 sig);
int wasm_import(user, call_siginfo_handler)(u32 trampoline, u32 fn, u32 sig);
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
void wasm_import(virtio, reset)(u32 id);

void wasm_import(virtio, enable_vring)(u32 id, u32 index, u32 size,
				       dma_addr_t desc, u32 irq);
void wasm_import(virtio, disable_vring)(u32 id, u32 index);

void wasm_import(virtio, notify)(u32 id, u32 index);
/* Synchronous: host may rewrite the shared config buffer before return. */
void wasm_import(virtio, config_written)(u32 id);
#endif

#ifdef CONFIG_FB_WASM
void wasm_import(fb, get_mode)(u32 *width, u32 *height, u32 *bpp);
void wasm_import(fb, present)(void *addr, u32 width, u32 height, u32 stride,
			      u32 bpp);
#endif

#undef wasm_import

#endif
