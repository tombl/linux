#ifndef _WASM_WASM_IMPORTS_H
#define _WASM_WASM_IMPORTS_H

#include <linux/types.h>
#include <linux/string.h>

#define import(name) __attribute__((import_module("kernel"), import_name(name)))

import("print") void wasm_print(const char *msg, size_t len);

import("set_irq_enabled") void wasm_set_irq_enabled(int enabled);
import("get_irq_enabled") int wasm_get_irq_enabled(void);

import("return_address") void *wasm_return_address(int level);

import("relax") void wasm_relax(void);

import("get_cmdline") void wasm_get_cmdline(char *buf, size_t size);

#undef import

#define wasm_puts(msg) wasm_print(msg, strlen(msg))

#endif
