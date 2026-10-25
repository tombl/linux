#include <linux/entry-common.h>
#include <linux/rcupdate.h>
#include <linux/syscalls.h>
#include <asm/irq.h>
#include <asm/remote_vm.h>
#include <asm/wasm_imports.h>

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

static noinline long wasm_do_syscall(long nr, unsigned long arg0,
				     unsigned long arg1, unsigned long arg2,
				     unsigned long arg3, unsigned long arg4,
				     unsigned long arg5)
{
	struct pt_regs *regs = current_pt_regs();

	/*
	 * A start function, run by an exec in place before the exec commits,
	 * gets no syscalls: they would act for the old image, nested in exec.
	 * wasm_copy_active_siginfo() refuses it too.
	 */
	if (unlikely(current_thread_info()->exec_preparing))
		return -ENOSYS;

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

		/*
		 * A successful exec continues in its successor worker, which
		 * completes this return to userspace in the new image.
		 */
		if (unlikely(current_thread_info()->exec_handoff))
			wasm_user_exec_handoff();

		syscall_exit_to_user_mode(regs);
		regs->user_mode = 1;

		if (unlikely(current_thread_info()->exec_restart)) {
			current_thread_info()->exec_restart = false;
			/* The handler that called execve, if any, is gone. */
			current_thread_info()->active_siginfo = NULL;
			wasm_user_unwind();
		}

		if (regs->restart_syscall_nr < 0)
			return regs->syscall_return;
		nr = regs->restart_syscall_nr;
	}
}

void wasm_finish_handler_escape(void);

/*
 * Userspace imports this export as linux.syscall, and the host links it
 * directly, so a syscall is a wasm-to-wasm call with no JS frame. The number,
 * the six argument slots and the result are longs, so the signature is
 * (i32, i32 x 6) -> i32 on wasm32. See asm/syscall_wrapper.h for how a 64-bit
 * argument spans two slots.
 *
 * A successful execve never returns here: the old instance's worker hands
 * the task to its successor, which finishes the return in the new image on
 * a fresh kernel stack. The old worker's stack is retired with it, including
 * the frames of a syscall that delivered a signal whose handler called
 * execve. An exec in place unwinds to run_user() instead, which enters the
 * new image with that stack reclaimed.
 *
 * A signal handler that escaped through an exception, such as siglongjmp(),
 * left the kernel frames beneath it to finish normally. Its exception is
 * rethrown here, after the inner call has returned, so this frame keeps
 * nothing on the shadow stack.
 */
__attribute__((export_name("syscall"))) long
wasm_syscall(long nr, unsigned long arg0, unsigned long arg1,
	     unsigned long arg2, unsigned long arg3, unsigned long arg4,
	     unsigned long arg5)
{
	struct thread_info *ti = current_thread_info();
	long ret;

	ret = wasm_do_syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);
	if (unlikely(ti->handler_escaped)) {
		ti->handler_escaped = 0;
		wasm_finish_handler_escape();
		wasm_user_rethrow();
	}
	return ret;
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
