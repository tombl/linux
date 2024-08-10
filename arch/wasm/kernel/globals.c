#include <asm/smp.h>
#include <asm/page.h>
#include <asm/thread_info.h>
#include <linux/cache.h>
#include <linux/screen_info.h>

unsigned long init_stack[THREAD_SIZE / sizeof(unsigned long)] = { 0 };
unsigned long empty_zero_page[PAGE_SIZE / sizeof(unsigned long)] = { 0 };
struct task_struct *current_tasks[NR_CPUS] = { 0 };
struct __wasm_irqflag wasm_irqflags[NR_CPUS] __cacheline_aligned = { 0 };

struct screen_info screen_info = {};

__asm__(".globaltype current_cpu, i32\ncurrent_cpu:\n"
	".globaltype current_task, i32\ncurrent_task:\n");

void set_current_cpu(int cpu)
{
	__asm__ volatile("local.get %0\n"
			 "global.set current_cpu" ::"r"(cpu));
}
int get_current_cpu(void)
{
	int cpu;
	__asm__ volatile("global.get current_cpu\n"
			 "local.set %0"
			 : "=r"(cpu));
	return cpu;
}

void set_current_task(struct task_struct *task)
{
	current_tasks[raw_smp_processor_id()] = task;
	__asm__ volatile("local.get %0\n"
			 "global.set current_task" ::"r"(task));
}
struct task_struct *get_current_task(void)
{
	struct task_struct *task;
	__asm__ volatile("global.get current_task\n"
			 "local.set %0"
			 : "=r"(task));
	return task;
}
struct task_struct *get_current_task_on(int cpu)
{
	return current_tasks[raw_smp_processor_id()];
}
