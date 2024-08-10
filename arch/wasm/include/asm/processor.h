#ifndef _WASM_PROCESSOR_H
#define _WASM_PROCESSOR_H

#include <asm/bug.h>
#include <asm/current.h>
#include <asm/globals.h>
#include <asm/thread_info.h>
#include <asm/wasm_imports.h>

struct task_struct;

void cpu_relax(void);

#define current_text_addr() wasm_return_address(-1)

static inline unsigned long thread_saved_pc(struct task_struct *tsk)
{
	BUG();
	return 0;
}

static inline void prepare_to_copy(struct task_struct *tsk)
{
	BUG();
}

static inline unsigned long __get_wchan(struct task_struct *p)
{
	BUG();
	return 0;
}

static inline void flush_thread(void)
{
	BUG();
}

struct thread_struct {};

#define INIT_THREAD \
	{           \
	}

#define task_pt_regs(task) \
	((struct pt_regs *)(task->stack + THREAD_SIZE) - 1)

// I believe this is unreferenced in nommu:
#define TASK_SIZE (__builtin_trap(),U32_MAX)

#define TASK_UNMAPPED_BASE 0

#define KSTK_EIP(tsk) (0)
#define KSTK_ESP(tsk) (0)

#define on_thread_stack() \
	((unsigned long)(current->stack - get_stack_pointer()) < THREAD_SIZE)

#endif
