#ifndef _WASM_MMU_CONTEXT_H
#define _WASM_MMU_CONTEXT_H

#include <linux/types.h>

struct mm_struct;
struct task_struct;

int wasm_mm_init_context(struct mm_struct *mm);
void wasm_mm_destroy_context(struct mm_struct *mm);

/*
 * mm_context_t carries a kernel-side cmdline copy (see asm/mmu.h). A new
 * mm must never inherit the pointer from the mm it was memcpy'd from
 * (dup_mm), and the copy has to be freed with the mm.
 */
#define init_new_context init_new_context
static inline int init_new_context(struct task_struct *tsk,
				   struct mm_struct *mm)
{
	return wasm_mm_init_context(mm);
}

#define destroy_context destroy_context
static inline void destroy_context(struct mm_struct *mm)
{
	wasm_mm_destroy_context(mm);
}

#include <asm-generic/nommu_context.h>

#endif
