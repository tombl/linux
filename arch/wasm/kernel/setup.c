#include <asm/bug.h>
#include <asm/sections.h>
#include <asm/setup.h>
#include <asm/sysmem.h>
#include <linux/libfdt.h>
#include <linux/memblock.h>
#include <linux/of_fdt.h>
#include <linux/percpu.h>
#include <linux/sched.h>
#include <linux/screen_info.h>
#include <linux/start_kernel.h>

void __wasm_call_ctors(void);
int __init setup_early_printk(char *buf);
void init_sections(unsigned long node);
extern void *__start___param, *__stop___param;
extern void *__setup_start, *__setup_end;

__attribute__((export_name("boot"))) void __init _start(void)
{
	static char wasm_dt[1024];
	int node;

	set_current_cpu(0);
	set_current_task(&init_task);
	
	memblock_reserve(0, (phys_addr_t)&__heap_base);

	wasm_get_dt(wasm_dt, ARRAY_SIZE(wasm_dt));
	BUG_ON(!early_init_dt_scan(wasm_dt));
	early_init_fdt_scan_reserved_mem();

	node = fdt_path_offset(wasm_dt, "/data-sections");
	if (node < 0)
		__builtin_trap();

	setup_early_printk(NULL);
	__wasm_call_ctors();
	init_sections(node);

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

	unflatten_and_copy_device_tree();

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
