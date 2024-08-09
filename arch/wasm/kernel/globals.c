#include <asm/page.h>
#include <asm/thread_info.h>
#include <linux/screen_info.h>

unsigned long init_stack[THREAD_SIZE / sizeof(unsigned long)] = { 0 };
unsigned long empty_zero_page[PAGE_SIZE / sizeof(unsigned long)] = { 0 };
struct task_struct *current_tasks[NR_CPUS] = { 0 };

struct screen_info screen_info = {};

__asm__(".globaltype current_cpu, i32\n"
	"current_cpu:");

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
