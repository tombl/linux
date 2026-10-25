#include <linux/entry-common.h>
#include <linux/rcupdate.h>
#include <linux/syscalls.h>
#include <asm/irq.h>
#include <asm/remote_vm.h>

#define sys_sigaltstack sys_wasm_sigaltstack
#undef __SYSCALL
#define __SYSCALL(nr, sym) asmlinkage long sym(const struct pt_regs *regs);
#include <asm/unistd.h>

typedef asmlinkage long (*syscall_handler_t)(const struct pt_regs *regs);

#undef __SYSCALL
#define __SYSCALL(nr, sym) [nr] = (syscall_handler_t)sym,

syscall_handler_t syscall_table[__NR_syscalls] = {
	[0 ... __NR_syscalls - 1] = (syscall_handler_t)sys_ni_syscall,
#include <asm/unistd.h>
#undef sys_sigaltstack
};

__attribute__((export_name("syscall"))) long
wasm_syscall(long nr, unsigned long arg0, unsigned long arg1,
	     unsigned long arg2, unsigned long arg3, unsigned long arg4,
	     unsigned long arg5)
{
	struct pt_regs *regs = current_pt_regs();
	struct thread_info *ti = current_thread_info();
	bool cancellation_point = nr & __WASM_SYSCALL_CP;
	/*
	 * A snapshot rather than a flag cleared here, because a handler that
	 * runs during this syscall can make a nested cancellation point.
	 */
	unsigned int cancel_signals = ti->cancel_signals;

	nr &= ~__WASM_SYSCALL_CP;

	regs->syscall_args[0] = arg0;
	regs->syscall_args[1] = arg1;
	regs->syscall_args[2] = arg2;
	regs->syscall_args[3] = arg3;
	regs->syscall_args[4] = arg4;
	regs->syscall_args[5] = arg5;

	for (;;) {
		/*
		 * WebAssembly has no asynchronous trap from user mode.  Reaching
		 * this boundary therefore proves that the CPU passed through a
		 * userspace RCU quiescent state.  It also gives the generic entry
		 * code the IRQ-disabled state it expects.
		 */
		local_irq_disable();
		rcu_note_context_switch(false);
		regs->user_mode = 0;
		nr = syscall_enter_from_user_mode(regs, nr);
		regs->syscall_nr = nr;
		regs->restart_syscall_nr = -1;

		/*
		 * Deliver timers armed against a busy task that only enters the
		 * kernel for syscalls; nothing else polls the clockevent deadline
		 * for it.
		 */
		wasm_timer_check();
		wasm_service_remote_request(current);

		if (nr < 0 || nr >= ARRAY_SIZE(syscall_table))
			regs->syscall_return = -ENOSYS;
		else
			regs->syscall_return = syscall_table[nr](regs);

		syscall_exit_to_user_mode(regs);
		regs->user_mode = 1;

		if (regs->restart_syscall_nr < 0)
			return regs->syscall_return;

		/*
		 * Native libc leaves a cancelled cancellation point by rewriting
		 * the interrupted PC. Here, refuse the restart instead, so the
		 * caller sees -EINTR and acts on its cancel flag. Checking after
		 * the whole signal-exit loop also catches a cancel signal that a
		 * nested handler's own syscall consumed.
		 */
		if (cancellation_point && ti->cancel_signals != cancel_signals)
			return -EINTR;

		nr = regs->restart_syscall_nr;
	}
}

/*
 * The generic implementation queries the unavailable wasm userspace stack
 * pointer and traps. Until alternate signal stacks are implementable, expose
 * the unsupported syscall honestly instead.
 */
SYSCALL_DEFINE0(wasm_sigaltstack)
{
	return -ENOSYS;
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
