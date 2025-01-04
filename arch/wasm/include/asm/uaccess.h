#ifndef _WASM_UACCESS_H
#define _WASM_UACCESS_H

#include <asm/wasm_imports.h>

#define __access_ok __access_ok
static inline int __access_ok(const void __user *ptr, unsigned long size)
{
	unsigned long limit = TASK_SIZE;
	unsigned long addr = (unsigned long)ptr;

	return (size <= limit) && (addr <= (limit - size));
}

#define raw_copy_from_user wasm_user_read
#define raw_copy_to_user wasm_user_write
#define __clear_user wasm_user_write_zeroes

#define INLINE_COPY_FROM_USER
#define INLINE_COPY_TO_USER

#include <asm-generic/uaccess.h>

#endif