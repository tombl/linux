#include <asm/bug.h>
#include <asm/sections.h>
#include <asm/setup.h>
#include <linux/libfdt.h>
#include <linux/memblock.h>
#include <linux/of.h>
#include <linux/of_fdt.h>
#include <linux/panic.h>
#include <linux/percpu.h>
#include <linux/sched.h>
#include <linux/screen_info.h>
#include <linux/start_kernel.h>

void __wasm_call_ctors(void);
int __init setup_early_printk(char *buf);
void __init smp_init_cpus(unsigned int ncpus);
void __init init_sections(unsigned long node);

char *__initramfs_start;
unsigned long __initramfs_size;

static void do_start_kernel(void *unused)
{
	set_current_cpu(0);
	set_current_task(&init_task);
	start_kernel();
}

static void *__init load_devicetree(size_t *size)
{
	phys_addr_t bootstrap_size;
	void *devicetree;
	size_t copied;

	*size = wasm_boot_get_devicetree(NULL, 0);
	BUG_ON(!*size || *size > INT_MAX);

	/*
	 * memblock has no memory ranges until it reads /memory from the FDT.
	 * Temporarily describe the materialized linear memory plus enough space
	 * for this exact blob, then remove that description before the FDT scan
	 * installs the authoritative range.
	 */
	bootstrap_size = PFN_PHYS(__builtin_wasm_memory_size(0));
	BUG_ON(bootstrap_size > PHYS_ADDR_MAX - PAGE_SIZE);
	BUG_ON(*size > PHYS_ADDR_MAX - bootstrap_size - PAGE_SIZE);
	bootstrap_size = PAGE_ALIGN(bootstrap_size + *size);
	BUG_ON(memblock_add(0, bootstrap_size));

	devicetree = memblock_alloc_or_panic(
		*size, roundup_pow_of_two(FDT_V17_SIZE));
	copied = wasm_boot_get_devicetree(devicetree, *size);
	BUG_ON(copied != *size || fdt_check_header(devicetree) ||
	       fdt_totalsize(devicetree) > *size);
	BUG_ON(memblock_remove(0, bootstrap_size));
	return devicetree;
}

__attribute__((export_name("boot"))) void __init _start(void)
{
	static char initramfs[512];
	void *devicetree;
	size_t devicetree_size;
	int node;

	memblock_set_bottom_up(true);
	set_current_cpu(0);
	set_current_task(&init_task);

	memblock_reserve(0, (phys_addr_t)&__heap_base);

	__initramfs_start = initramfs;
	__initramfs_size = wasm_boot_get_initramfs(initramfs, ARRAY_SIZE(initramfs));

	devicetree = load_devicetree(&devicetree_size);
	BUG_ON(!early_init_dt_scan(devicetree, __pa(devicetree)));
	BUG_ON(!memblock_is_region_memory(__pa(devicetree), devicetree_size));
	early_init_fdt_scan_reserved_mem();

	node = fdt_path_offset(devicetree, "/chosen/sections");
	if (node < 0)
		__builtin_trap();

	setup_early_printk(NULL);
	__wasm_call_ctors();
	init_sections(node);

	// ensure that any future work done on this thread won't interfere with the kernel
	set_current_cpu(-2); // -1 is reserved for unscheduled tasks
	set_current_task(NULL);

	wasm_kernel_spawn_worker(do_start_kernel, NULL, "boot", sizeof "boot" - 1,
				 WASM_USER_MEMORY_NONE);
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
}

static void __noreturn terminate_machine(
	enum wasm_machine_termination_reason reason)
{
	wasm_kernel_terminate_machine(reason);
	wasm_kernel_halt_worker();
	__builtin_unreachable();
}

void machine_restart(char *cmd)
{
	pr_info("restart %s\n", cmd);
	terminate_machine(panic_in_progress() ?
		WASM_MACHINE_TERMINATION_PANIC :
		WASM_MACHINE_TERMINATION_CLEAN);
}

void machine_halt(void)
{
	pr_info("halt\n");
	terminate_machine(WASM_MACHINE_TERMINATION_CLEAN);
}
void machine_power_off(void)
{
	pr_info("poweroff\n");
	terminate_machine(WASM_MACHINE_TERMINATION_CLEAN);
}
