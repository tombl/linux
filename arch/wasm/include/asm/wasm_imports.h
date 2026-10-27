#ifndef _WASM_WASM_IMPORTS_H
#define _WASM_WASM_IMPORTS_H

#include <linux/types.h>

#define wasm_import(ns, name)                                   \
	__attribute__((import_module(#ns), import_name(#name))) \
	wasm_##ns##_##name

/*
 * Boot blobs are pulled from the host. Each call copies the blob into buf and
 * returns its size; called with (NULL, 0), it returns the size alone, which is
 * 0 when the host has no such blob.
 */
size_t wasm_import(boot, get_devicetree)(char *buf, size_t size);
size_t wasm_import(boot, get_initramfs)(char *buf, size_t size);
size_t wasm_import(boot, get_initrd)(char *buf, size_t size);

void wasm_import(kernel, breakpoint)(void);
void wasm_import(kernel, halt_worker)(void);

/*
 * Whole-machine lifecycle event. CLEAN is a power-off or halt, and REBOOT
 * asks the host to boot the machine again. Values are part of the
 * guest/host ABI.
 */
enum wasm_machine_termination_reason {
	WASM_MACHINE_TERMINATION_CLEAN = 0,
	WASM_MACHINE_TERMINATION_PANIC = 1,
	WASM_MACHINE_TERMINATION_REBOOT = 2,
};

void wasm_import(kernel, terminate_machine)(
	enum wasm_machine_termination_reason reason);

/*
 * The host presses the machine's power button with the power_button export.
 * It returns 0 for the first press of a boot, -EINVAL for an unknown action,
 * -EAGAIN early in boot, before the button exists, or -EBUSY after an earlier
 * press or once a shutdown is under way. Values are part of the guest/host ABI.
 */
enum wasm_power_action {
	WASM_POWER_OFF = 1,
	WASM_POWER_REBOOT = 2,
};

int power_button(enum wasm_power_action action);

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

/* See asm/spawn.h. */
struct wasm_spawn_wait;

/*
 * spawn_worker never blocks: the new worker may not start until another one
 * exits, so the kernel sleeps for the result instead, see
 * wasm_spawn_worker_wait(). WASM_USER_MEMORY_COPY and WASM_USER_MEMORY_EXEC
 * take a wait, and the others pass NULL.
 *
 * For WASM_USER_MEMORY_COPY, success means the destination worker has
 * completed its private snapshot; allocation failure is -ENOMEM.
 *
 * WASM_USER_MEMORY_EXEC spawns the successor of the calling worker, which
 * hosts the image from the last successful compile_end. Success means the
 * successor has allocated the image's memory and instantiated it, and is
 * waiting for user_exec_handoff() before it calls fn(arg). compile_abort()
 * ends a successor that never received the handoff.
 */
int wasm_import(kernel, spawn_worker)(void (*fn)(void *), void *arg,
				      char *name, size_t name_len,
				      enum wasm_user_memory user_memory,
				      struct wasm_spawn_wait *wait);

void wasm_import(kernel, run_on_main)(void (*fn)(void *), void *arg);

int wasm_import(user, compile_begin)(u32 len);
int wasm_import(user, compile_write)(u8 *bytes, u32 offset, u32 len);
int wasm_import(user, compile_end)(u32 maximum_memory_pages);
void wasm_import(user, compile_abort)(void);
/* Lets the exec successor run, then ends this worker. */
void wasm_import(user, exec_handoff)(void) __attribute__((noreturn));
/*
 * Exec in place, for a worker that hosts borrowed user memory: allocate the
 * memory of the image from the last successful compile_end in this worker
 * and instantiate it, while exec can still fail (-ENOMEM, or -ENOEXEC if
 * instantiation fails; compile_abort() drops it). Past the point of no
 * return, exec_instantiate() installs it, which cannot fail.
 */
int wasm_import(user, exec_prepare)(void);
void wasm_import(user, exec_instantiate)(void);
/*
 * Abandons the user stack and returns from call() with true, so the kernel
 * can enter the image that exec_instantiate() installed.
 */
void wasm_import(user, unwind)(void) __attribute__((noreturn));
/* Returns true if an exec in place replaced the image, see unwind(). */
bool wasm_import(user, call)(void);
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
