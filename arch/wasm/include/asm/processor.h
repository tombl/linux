#ifndef _WASM_PROCESSOR_H
#define _WASM_PROCESSOR_H

#include <asm/wasm_imports.h>

struct task_struct;

static inline void cpu_relax(void)
{
	wasm_relax();
}

#define current_text_addr() wasm_return_address(-1)

static inline unsigned long thread_saved_pc(struct task_struct *tsk)
{
	return 0;
}

static inline void prepare_to_copy(struct task_struct *tsk)
{
}

static inline unsigned long __get_wchan(struct task_struct *p)
{
	return 0;
}

static inline void flush_thread(void)
{
}

struct thread_struct {};

#define INIT_THREAD \
	{           \
	}

#define task_pt_regs(tsk) (struct pt_regs *)(NULL)

#define TASK_SIZE U32_MAX
#define TASK_UNMAPPED_BASE 0

#define KSTK_EIP(tsk) (0)
#define KSTK_ESP(tsk) (0)

#endif
