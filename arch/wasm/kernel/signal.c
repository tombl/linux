#include <asm/wasm_imports.h>
#include <asm/unistd.h>
#include <linux/entry-common.h>
#include <linux/errno.h>
#include <linux/signal.h>
#include <linux/syscalls.h>
#include <linux/task_work.h>

static void syscall_restart(struct pt_regs *regs, bool handler,
			    const struct k_sigaction *ka)
{
	/* Recompute the decision for each pass through the signal-exit loop. */
	regs->restart_syscall_nr = -1;

	switch (regs->syscall_return) {
	case -ERESTARTNOHAND:
		if (handler)
			regs->syscall_return = -EINTR;
		else
			regs->restart_syscall_nr = regs->syscall_nr;
		break;
	case -ERESTARTSYS:
		if (handler && !(ka->sa.sa_flags & SA_RESTART))
			regs->syscall_return = -EINTR;
		else
			regs->restart_syscall_nr = regs->syscall_nr;
		break;
	case -ERESTARTNOINTR:
		regs->restart_syscall_nr = regs->syscall_nr;
		break;
	case -ERESTART_RESTARTBLOCK:
		if (handler)
			regs->syscall_return = -EINTR;
		else
			regs->restart_syscall_nr = __NR_restart_syscall;
		break;
	}
}

static void call_signal_handler(struct ksignal *ksig, struct pt_regs *regs)
{
	const struct sigaction *sa = &ksig->ka.sa;
	struct thread_info *ti = current_thread_info();
	struct pt_regs saved_regs = *regs;
	/*
	 * The mask a signal frame would save: the caller's own one, rather than
	 * the temporary mask of an interrupted sigsuspend, ppoll or pselect.
	 */
	sigset_t saved_mask = *sigmask_to_save();
	int result;

	/*
	 * wasm invokes the userspace handler synchronously. Mirror the mask setup
	 * normally performed before returning through a userspace signal frame,
	 * then restore it in place of rt_sigreturn when the callback returns.
	 */
	signal_setup_done(0, ksig, 0);

	/*
	 * The callback runs userspace code before the outer syscall exit has
	 * completed its context-tracking transition. Make that transition here so
	 * syscalls made by a handler enter from a real userspace context.
	 */
	local_irq_disable();
	regs->user_mode = 1;
	exit_to_user_mode();
	local_irq_enable();

	if (sa->sa_flags & SA_SIGINFO) {
		const kernel_siginfo_t *previous = ti->active_siginfo;

		ti->active_siginfo = &ksig->info;
		result = wasm_user_call_siginfo_handler(
			(uintptr_t)sa->sa_restorer, (uintptr_t)sa->sa_handler,
			ksig->sig);
		ti->active_siginfo = previous;
	} else {
		result = wasm_user_call_signal_handler(
			(uintptr_t)sa->sa_handler, ksig->sig);
	}

	local_irq_disable();
	enter_from_user_mode(regs);
	local_irq_enable();

	/*
	 * A synchronous handler can make nested syscalls, which use the same
	 * task_pt_regs storage. Preserve the interrupted syscall's result and
	 * restart decision across those calls.
	 */
	*regs = saved_regs;

	if (result == WASM_HANDLER_ESCAPED) {
		/*
		 * The handler left through an exception, such as siglongjmp(),
		 * the way a handler leaves a signal frame it never returns to:
		 * the mask it ran with stays, and the interrupted syscall is
		 * abandoned. Finish the syscall without restarting it, so that
		 * its kernel frames unwind, and rethrow at the syscall export.
		 */
		regs->syscall_return = -EINTR;
		regs->restart_syscall_nr = -1;
		ti->handler_escaped = 1;
		return;
	}

	set_current_blocked(&saved_mask);
	if (result < 0)
		force_sigsegv(ksig->sig);
}

/*
 * Called by the syscall export just before it rethrows a handler's escape.
 * Signals that arrived meanwhile are delivered at the next syscall.
 */
void wasm_finish_handler_escape(void)
{
	/* Unlike recalc_sigpending(), this also keeps a pending freeze. */
	calculate_sigpending();
}

__attribute__((export_name("copy_siginfo"))) int
wasm_copy_active_siginfo(siginfo_t __user *to)
{
	const kernel_siginfo_t *info = current_thread_info()->active_siginfo;

	return info ? copy_siginfo_to_user(to, info) : -EINVAL;
}

__attribute__((export_name("clear_siginfo"))) void
wasm_clear_active_siginfo(void)
{
	current_thread_info()->active_siginfo = NULL;
}

void arch_do_signal_or_restart(struct pt_regs *regs)
{
	struct ksignal ksig;

	/*
	 * Once a handler has escaped, run nothing more on this exit, not even
	 * a ptrace stop: a further handler would run beneath the pending
	 * exception, and the export would rethrow that into its first
	 * syscall. Leave signals queued and drop the pending flag until the
	 * export has rethrown; wasm_finish_handler_escape() recomputes it.
	 * Run task work as get_signal() would, so the exit loop can finish.
	 */
	if (current_thread_info()->handler_escaped) {
		clear_notify_signal();
		if (unlikely(task_work_pending(current)))
			task_work_run();
		clear_thread_flag(TIF_SIGPENDING);
		return;
	}

	if (get_signal(&ksig)) {
		syscall_restart(regs, true, &ksig.ka);
		call_signal_handler(&ksig, regs);
		return;
	}

	syscall_restart(regs, false, NULL);
	restore_saved_sigmask();
}
