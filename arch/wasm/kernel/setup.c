#include <asm/bug.h>
#include <asm/setup.h>
#include <asm/sysmem.h>
#include <linux/memblock.h>
#include <linux/of_fdt.h>
#include <linux/percpu.h>
#include <linux/sched.h>
#include <linux/screen_info.h>
#include <linux/start_kernel.h>

unsigned long volatile jiffies = INITIAL_JIFFIES;

DEFINE_PER_CPU(struct task_struct *, current) = &init_task;

unsigned long init_stack[THREAD_SIZE / sizeof(unsigned long)];
unsigned long empty_zero_page[PAGE_SIZE / sizeof(unsigned long)] = { 0 };

char __init_begin[0], __init_end[0], __stop___ex_table, __start___ex_table,
	__start___ex_table, __stop___ex_table, __start___ex_table,
	__stop___ex_table, __start___ex_table, __start___ex_table,
	__stop___ex_table, __start___ex_table, __sched_text_start,
	__sched_text_end, __cpuidle_text_start, __cpuidle_text_end,
	__lock_text_start, __lock_text_end, __reservedmem_of_table,
	__reservedmem_of_table;

struct screen_info screen_info = {};

// https://github.com/llvm/llvm-project/blob/d2e4a725da5b4cbef8b5c1446f29fed1487aeab0/lld/wasm/Symbols.h#L515
void __init __wasm_call_ctors(void);
extern void __stack_low;
extern void __stack_high;
extern void __heap_base;
extern void __heap_end;

int __init setup_early_printk(char *buf);
size_t __per_cpu_size;

__attribute__((export_name("boot"))) void __init _start(void)
{
	static char wasm_dt[1024];
	wasm_get_dt(wasm_dt, ARRAY_SIZE(wasm_dt));

#ifdef CONFIG_SMP
	early_tls_init();
#endif
	__wasm_call_ctors();

	setup_early_printk(NULL);

	early_init_dt_scan(wasm_dt);
	early_init_fdt_scan_reserved_mem();

	memblock_reserve(0, (phys_addr_t)&__heap_base);

	for (int i = 0; i < NR_CPUS; i++) {
		set_cpu_possible(i, true);
		set_cpu_present(i, true);
	}

	start_kernel();
}

void __init setup_arch(char **cmdline_p)
{
	static char command_line[COMMAND_LINE_SIZE];
	strscpy(command_line, boot_command_line, COMMAND_LINE_SIZE);
	*cmdline_p = command_line;

	parse_early_param();

	pr_info("Heap:\t%p -> %p = %td\n", &__heap_base, &__heap_end,
		&__heap_end - &__heap_base);
	pr_info("Stack:\t%p -> %p = %td\n", &__stack_low, &__stack_high,
		&__stack_high - &__stack_low);

	BUG_ON(THREAD_SIZE <
	       (&__stack_high - &__stack_low) + sizeof(struct task_struct));

	unflatten_device_tree();

	memblock_dump_all();

	zones_init();
}

void machine_restart(char *cmd)
{
	pr_info("restart %s\n", cmd);
	wasm_restart();
}

void machine_halt(void)
{
	pr_info("halt\n");
	BUG();
}
void machine_power_off(void)
{
	pr_info("poweroff\n");
	BUG();
}
