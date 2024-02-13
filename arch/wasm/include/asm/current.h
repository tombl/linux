#ifndef _WASM_CURRENT_H
#define _WASM_CURRENT_H

struct task_struct;

extern _Thread_local struct task_struct * current;

#endif
