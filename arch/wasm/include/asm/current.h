#ifndef _WASM_CURRENT_H
#define _WASM_CURRENT_H

#include <asm/percpu.h>

struct task_struct;

DECLARE_PER_CPU(struct task_struct*, current);

#endif
