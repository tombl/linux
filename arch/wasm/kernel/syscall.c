#include <linux/entry-common.h>
#include <linux/rcupdate.h>
#include <linux/syscalls.h>
#include <asm/irq.h>

#undef __SYSCALL
#define __SYSCALL(nr, sym) asmlinkage long sym(const struct pt_regs *regs);
#include <asm/unistd.h>

typedef asmlinkage long (*syscall_handler_t)(const struct pt_regs *regs);

#undef __SYSCALL
#define __SYSCALL(nr, sym) [nr] = (syscall_handler_t)sym,

syscall_handler_t syscall_table[__NR_syscalls] = {
	[0 ... __NR_syscalls - 1] = (syscall_handler_t)sys_ni_syscall,
#include <asm/unistd.h>
};

__attribute__((export_name("syscall"))) long
wasm_syscall(long nr, unsigned long arg0, unsigned long arg1,
	     unsigned long arg2, unsigned long arg3, unsigned long arg4,
	     unsigned long arg5)
{
	struct pt_regs *regs = current_pt_regs();
	long ret;

	/* WebAssembly has no asynchronous trap from user mode.  Reaching this
	 * boundary therefore proves that the CPU passed through a userspace RCU
	 * quiescent state.  It also gives the generic entry code the IRQ-disabled
	 * state it expects. */
	local_irq_disable();
	rcu_note_context_switch(false);
	regs->user_mode = 0;
	nr = syscall_enter_from_user_mode(regs, nr);

	/* Deliver timers armed against a busy task that only enters the kernel
	 * for syscalls; nothing else polls the clockevent deadline for it. */
	wasm_timer_check();

	if (nr < 0 || nr >= ARRAY_SIZE(syscall_table)) {
		ret = -ENOSYS;
	} else {
		regs->syscall_nr = nr;
		regs->syscall_args[0] = arg0;
		regs->syscall_args[1] = arg1;
		regs->syscall_args[2] = arg2;
		regs->syscall_args[3] = arg3;
		regs->syscall_args[4] = arg4;
		regs->syscall_args[5] = arg5;

		ret = syscall_table[nr](regs);
	}

	syscall_exit_to_user_mode(regs);
	regs->user_mode = 1;

	return ret;
}

SYSCALL_DEFINE1(set_thread_area, unsigned long, addr)
{
	struct thread_info *ti = task_thread_info(current);
	ti->tp_value = addr;
	return 0;
}

__attribute__((export_name("get_thread_area"))) unsigned long
wasm_get_thread_area(void)
{
	struct thread_info *ti = task_thread_info(current);
	return ti->tp_value;
}
