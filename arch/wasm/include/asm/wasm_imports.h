#ifndef _WASM_WASM_IMPORTS_H
#define _WASM_WASM_IMPORTS_H

#include <linux/types.h>
#include <linux/string.h>

#define import(name) __attribute__((import_module("kernel"), import_name(name)))

import("breakpoint") void wasm_breakpoint(void);
import("halt") void wasm_halt(void);
import("restart") void wasm_restart(void);

import("boot_console_write") void wasm_boot_console_write(const char *msg,
							  size_t len);
import("boot_console_close") void wasm_boot_console_close(void);

import("set_irq_enabled") void wasm_set_irq_enabled(int enabled);
import("get_irq_enabled") int wasm_get_irq_enabled(void);

import("return_address") void *wasm_return_address(int level);

import("get_dt") void wasm_get_dt(char *buf, size_t size);

import("get_now_nsec") unsigned long long wasm_get_now_nsec(void);

import("get_stacktrace") void wasm_get_stacktrace(char *buf, size_t size);

struct task_struct;
import("new_worker") void wasm_new_worker(int cpu, struct task_struct *task,
					  char *comm, size_t comm_len);

import("bringup_secondary") void wasm_bringup_secondary(int cpu, struct task_struct *idle);

#undef import

#endif
