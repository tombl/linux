#include <asm/bug.h>
#include <asm/sections.h>
#include <asm/setup.h>
#include <asm/sysmem.h>
#include <linux/libfdt.h>
#include <linux/memblock.h>
#include <linux/of.h>
#include <linux/of_fdt.h>
#include <linux/percpu.h>
#include <linux/sched.h>
#include <linux/screen_info.h>
#include <linux/start_kernel.h>

void __wasm_call_ctors(void);
int __init setup_early_printk(char *buf);
void __init smp_init_cpus(unsigned int ncpus);
void __init init_sections(unsigned long node);
void wasm_import(boot, get_devicetree)(char *buf, size_t size);

__attribute__((export_name("worker_entry"))) void
wasm_worker_entry(void (*fn)(void *), void *arg)
{
	fn(arg);
}

static void do_start_kernel(void *unused)
{
	set_current_cpu(0);
	set_current_task(&init_task);
	start_kernel();
}

__attribute__((export_name("boot"))) void __init _start(void)
{
	static char devicetree[2048];
	int node;

	set_current_cpu(0);
	set_current_task(&init_task);

	memblock_reserve(0, (phys_addr_t)&__heap_base);

	wasm_boot_get_devicetree(devicetree, ARRAY_SIZE(devicetree));
	BUG_ON(!early_init_dt_scan(devicetree));
	early_init_fdt_scan_reserved_mem();

	node = fdt_path_offset(devicetree, "/chosen/sections");
	if (node < 0)
		__builtin_trap();

	setup_early_printk(NULL);
	__wasm_call_ctors();
	init_sections(node);

	wasm_kernel_spawn_worker(do_start_kernel, NULL, "boot", 4);
}

void __init setup_arch(char **cmdline_p)
{
	static char command_line[COMMAND_LINE_SIZE];
	int ret, ncpus;
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

	ret = of_property_read_u32(of_chosen, "ncpus", &ncpus);
	if (ret) {
		pr_warn("failed to read '/chosen/ncpus', defaulting to 1: %d\n", ret);
		ncpus = 1;
	}
	smp_init_cpus(ncpus);

	memblock_dump_all();

	zones_init();
}

void machine_restart(char *cmd)
{
	pr_info("restart %s\n", cmd);
	wasm_kernel_restart();
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
