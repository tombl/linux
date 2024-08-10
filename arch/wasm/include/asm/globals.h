#ifndef _WASM_GLOBALS_H
#define _WASM_GLOBALS_H

#include <linux/types.h>

__asm__(".globaltype __stack_pointer, i32\n");
static inline void set_stack_pointer(void *ptr)
{
	__asm__ volatile("local.get %0\n"
			 "global.set __stack_pointer" ::"r"(ptr));
}
static inline void *get_stack_pointer(void)
{
	void* ptr;
	__asm__ volatile("global.get __stack_pointer\n"
			 "local.set %0"
			 : "=r"(ptr));
	return ptr;
}

void set_current_cpu(int cpu);
int get_current_cpu(void);

struct task_struct;
void set_current_task(struct task_struct *task);
struct task_struct *get_current_task(void);
struct task_struct *get_current_task_on(int cpu);

void set_irq_enabled(u32 flags);
u32 get_irq_enabled(void);

#endif
