#ifndef _WASM_MMU_CONTEXT_H
#define _WASM_MMU_CONTEXT_H

#include <linux/types.h>

struct mm_struct;
struct task_struct;

int wasm_init_new_context(struct task_struct *tsk, struct mm_struct *mm);
void wasm_destroy_context(struct mm_struct *mm);

#define init_new_context wasm_init_new_context
#define destroy_context wasm_destroy_context

#include <asm-generic/nommu_context.h>

#endif
