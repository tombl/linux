#include <asm/setup.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/init.h>
#include <linux/jiffies.h>
#include <linux/memblock.h>
#include <linux/mutex.h>
#include <linux/of_fdt.h>
#include <linux/printk.h>
#include <linux/screen_info.h>
#include <linux/start_kernel.h>
#include <linux/types.h>

unsigned long volatile jiffies = INITIAL_JIFFIES;

char __init_begin[0], __init_end[0];

struct thread_info *__current_thread_info = { 0 };

unsigned long init_stack[THREAD_SIZE / sizeof(unsigned long)];
unsigned long empty_zero_page[PAGE_SIZE / sizeof(unsigned long)] = { 0 };

uintptr_t __stop___ex_table, __start___ex_table, __sched_class_highest,
	__sched_class_lowest, __per_cpu_start, __end_rodata, __start_rodata,
	__per_cpu_load, __per_cpu_end, _stext, _etext, _sinittext, _einittext,
	__sched_text_start, __sched_text_end, __cpuidle_text_start,
	__cpuidle_text_end, __lock_text_start, __lock_text_end, __bss_start,
	__bss_stop, _sdata, _edata, __reservedmem_of_table, __start_builtin_fw,
	__end_builtin_fw;


struct screen_info screen_info = {};

// https://github.com/llvm/llvm-project/blob/d2e4a725da5b4cbef8b5c1446f29fed1487aeab0/lld/wasm/Symbols.h#L515
void __init __wasm_call_ctors(void);
extern void __stack_low;
extern void __stack_high;
extern void __heap_base;
extern void __heap_end;

int __init setup_early_printk(char *buf);

static char wasm_dt[1024];

void __init _start(void)
{
	__wasm_call_ctors();

	setup_early_printk(NULL);
	pr_info("heap: %zu->%zu=%zu\n", (uintptr_t)&__heap_base,
		(uintptr_t)&__heap_end,
		(uintptr_t)&__heap_end - (uintptr_t)&__heap_base);
	pr_info("stack: %zu->%zu=%zu\n", (uintptr_t)&__stack_low,
		(uintptr_t)&__stack_high,
		(uintptr_t)&__stack_high - (uintptr_t)&__stack_low);

	wasm_get_dt(wasm_dt, ARRAY_SIZE(wasm_dt));
	early_init_dt_scan(wasm_dt);

	memblock_reserve(0, (phys_addr_t)&__heap_base);

	start_kernel();
}

void __init setup_arch(char **cmdline_p)
{
	static char command_line[COMMAND_LINE_SIZE];
	strscpy(command_line, boot_command_line, COMMAND_LINE_SIZE);
	*cmdline_p = command_line;

	parse_early_param();

	unflatten_device_tree();

#ifdef CONFIG_SMP
	smp_init_cpus();
#endif

	memblock_dump_all();

	zones_init();
}

// extern void do_kernel_restart(char *cmd);
// extern void migrate_to_reboot_cpu(void);
// extern void machine_shutdown(void);
// struct pt_regs;
// extern void machine_crash_shutdown(struct pt_regs *);

void machine_restart(char *cmd)
{
	pr_info("restart: %s", cmd);
	__builtin_trap();
}

void machine_halt(void)
{
	pr_info("halt");
	__builtin_trap();
}
void machine_power_off(void)
{
	pr_info("poweroff");
	__builtin_trap();
}
