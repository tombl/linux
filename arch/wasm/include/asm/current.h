#ifndef _WASM_CURRENT_H
#define _WASM_CURRENT_H

#include <linux/threads.h>
#include <asm/smp.h>

struct task_struct;

extern struct task_struct *current_tasks[NR_CPUS];

static __always_inline struct task_struct *get_current(void)
{
	return current_tasks[raw_smp_processor_id()];
}

#define current get_current()

#endif
