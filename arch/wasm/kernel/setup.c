#include <asm/setup.h>
#include <asm/sysmem.h>
#include <asm/wasm_imports.h>
#include <linux/init.h>
#include <linux/jiffies.h>
#include <linux/memblock.h>
#include <linux/mutex.h>
#include <linux/of_fdt.h>
#include <linux/printk.h>
#include <linux/start_kernel.h>
#include <linux/types.h>

unsigned long volatile jiffies = INITIAL_JIFFIES;

char __init_begin[0], __init_end[0];

struct thread_info *__current_thread_info = { 0 };

unsigned long init_stack[THREAD_SIZE / sizeof(unsigned long)];
unsigned long empty_zero_page[PAGE_SIZE / sizeof(unsigned long)] = { 0 };

uintptr_t __start___param, __stop___param, __stop___ex_table,
	__start___ex_table, __sched_class_highest, __sched_class_lowest,
	__per_cpu_start, __end_rodata, __start_rodata, __per_cpu_load,
	__per_cpu_end, _stext, _etext, _sinittext, _einittext,
	__sched_text_start, __sched_text_end, __cpuidle_text_start,
	__cpuidle_text_end, __lock_text_start, __lock_text_end, __bss_start,
	__bss_stop, _sdata, _edata, __reservedmem_of_table;

void __init __wasm_call_ctors(void);
int __init setup_early_printk(char *buf);

static char wasm_dt[512];

void __init _start(void)
{
	__wasm_call_ctors();

	wasm_get_dt(wasm_dt, sizeof(wasm_dt) / sizeof(wasm_dt[0]));
	early_init_dt_scan(wasm_dt);

	start_kernel();
}

void __init setup_arch(char **cmdline_p)
{
	wasm_get_cmdline(boot_command_line, COMMAND_LINE_SIZE);
	*cmdline_p = boot_command_line;

#ifdef CONFIG_BLK_DEV_INITRD
	if (initrd_start < initrd_end &&
	    !mem_reserve(__pa(initrd_start), __pa(initrd_end)))
		initrd_below_start_ok = 1;
	else
		initrd_start = 0;
#endif

	parse_early_param();
	early_printk("hello!\n");

	bootmem_init();

	unflatten_device_tree();

#ifdef CONFIG_SMP
	smp_init_cpus();
#endif

	zones_init();
}

// extern void do_kernel_restart(char *cmd);
// extern void migrate_to_reboot_cpu(void);
// extern void machine_shutdown(void);
// struct pt_regs;
// extern void machine_crash_shutdown(struct pt_regs *);

void machine_restart(char *cmd)
{
	early_printk("restart: %s", cmd);
	__builtin_trap();
}

void machine_halt(void)
{
	early_printk("halt");
	__builtin_trap();
}
void machine_power_off(void)
{
	early_printk("poweroff");
	__builtin_trap();
}
