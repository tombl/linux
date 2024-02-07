#include <asm/setup.h>
#include <asm/wasm_imports.h>
#include <linux/init.h>
#include <linux/jiffies.h>
#include <linux/memblock.h>
#include <linux/mutex.h>
#include <linux/printk.h>
#include <linux/start_kernel.h>
#include <linux/types.h>

unsigned long volatile jiffies = INITIAL_JIFFIES;

#define fake_linker_array(type, name, size)                 \
	type __##name##_start[size];                        \
	type __##name##_end[0];                             \
	unsigned long __##name##_idx = 0;                   \
	void __##name##_push(const type param)              \
	{                                                   \
		if (__##name##_idx >= (size))               \
			__builtin_trap();                   \
		__##name##_start[__##name##_idx++] = param; \
	}

fake_linker_array(struct obs_kernel_param, setup, 100);
fake_linker_array(initcall_entry_t, con_initcall, 100);
fake_linker_array(initcall_entry_t, initcall, 100);
fake_linker_array(initcall_entry_t, initcall0, 100);
fake_linker_array(initcall_entry_t, initcall1, 100);
fake_linker_array(initcall_entry_t, initcall2, 100);
fake_linker_array(initcall_entry_t, initcall3, 100);
fake_linker_array(initcall_entry_t, initcall4, 100);
fake_linker_array(initcall_entry_t, initcall5, 100);
fake_linker_array(initcall_entry_t, initcall6, 100);
fake_linker_array(initcall_entry_t, initcall7, 100);

char __init_begin[0], __init_end[0];

struct thread_info *__current_thread_info = { 0 };

unsigned long init_stack[THREAD_SIZE / sizeof(unsigned long)];

uintptr_t __start___param, __stop___param, __stop___ex_table, __start___ex_table,
	__sched_class_highest, __sched_class_lowest, __per_cpu_start,
	__end_rodata, __start_rodata, __per_cpu_load, __per_cpu_end, _stext,
	_etext, _sinittext, _einittext, __sched_text_start, __sched_text_end,
	__cpuidle_text_start, __cpuidle_text_end, __lock_text_start,
	__lock_text_end, __bss_start, __bss_stop, _sdata, _edata;

__printf(1, 2) static inline void very_early_printk(const char *fmt, ...)
{
	char buf[256];
	va_list args;

	va_start(args, fmt);
	int len = vscnprintf(buf, sizeof(buf), fmt, args);
	va_end(args);

	wasm_print(buf, len);
}

void __init __wasm_call_ctors(void);
int __init setup_early_printk(char *buf);
void __init _start(void)
{
	__wasm_call_ctors();

	// DEFINE_MUTEX(testmu);
	// mutex_init(&testmu);
	// very_early_printk("pre lock %i %i\n", mutex_is_locked(&testmu), testmu.wait_lock.raw_lock.locked);
	// mutex_lock(&testmu);
	// mutex_lock(&testmu);
	// very_early_printk("locked %i %i\n", mutex_is_locked(&testmu), testmu.wait_lock.raw_lock.locked);
	// mutex_unlock(&testmu);
	// very_early_printk("post lock %i %i\n", mutex_is_locked(&testmu), testmu.wait_lock.raw_lock.locked);

	setup_early_printk(NULL);
	early_printk("booting kernel:\n");

	void *allocation_ = memblock_alloc(10, 0);
	early_printk("memblock_alloc: %p\n", allocation_);

	void *allocation = memblock_alloc(10, SMP_CACHE_BYTES);
	early_printk("memblock_alloc: %p\n", allocation);

	// start_kernel();
}

static char wasm_cmdline[COMMAND_LINE_SIZE];
void __init setup_arch(char **cmdline_p)
{
	wasm_get_cmdline(wasm_cmdline, sizeof(wasm_cmdline));
	strscpy(wasm_cmdline, boot_command_line, COMMAND_LINE_SIZE);
	*cmdline_p = wasm_cmdline;

	parse_early_param();
	setup_arch_memory();

	for (int i = 0; i < NR_CPUS; i++)
		set_cpu_possible(i, true);
}

// extern void do_kernel_restart(char *cmd);
// extern void migrate_to_reboot_cpu(void);
// extern void machine_shutdown(void);
// struct pt_regs;
// extern void machine_crash_shutdown(struct pt_regs *);

void machine_restart(char *cmd)
{
	printk("restart: %s", cmd);
	__builtin_trap();
}

void machine_halt(void)
{
	printk("halt");
	__builtin_trap();
}
void machine_power_off(void)
{
	printk("poweroff");
	__builtin_trap();
}