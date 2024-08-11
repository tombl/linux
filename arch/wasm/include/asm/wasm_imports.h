#ifndef _WASM_WASM_IMPORTS_H
#define _WASM_WASM_IMPORTS_H

#include <linux/types.h>

#define wasm_import(ns, name)                                   \
	__attribute__((import_module(#ns), import_name(#name))) \
	wasm_##ns##_##name

void wasm_import(kernel, breakpoint)(void);
void wasm_import(kernel, halt)(void);
void wasm_import(kernel, restart)(void);

void wasm_import(kernel, boot_console_write)(const char *msg, size_t len);
void wasm_import(kernel, boot_console_close)(void);

void *wasm_import(kernel, return_address)(int level);

unsigned long long wasm_import(kernel, get_now_nsec)(void);

void wasm_import(kernel, get_stacktrace)(char *buf, size_t size);

struct task_bootstrap_args;
struct task_struct;
void wasm_import(kernel, new_worker)(struct task_bootstrap_args *task,
				     char *comm, size_t comm_len);

void wasm_import(kernel, bringup_secondary)(int cpu, struct task_struct *idle);

#endif
