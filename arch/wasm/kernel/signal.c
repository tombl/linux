#include <asm/wasm_imports.h>
#include <linux/syscalls.h>

void arch_do_signal_or_restart(struct pt_regs *regs) {
	struct ksignal ksig;

	if (get_signal(&ksig)) {
		struct sigaction* sa = &ksig.ka.sa;
		wasm_user_call_signal_handler((uintptr_t)sa->sa_handler, ksig.sig);
	}
}

SYSCALL_DEFINE0(rt_sigreturn)
{
	current->restart_block.fn = do_no_restart_syscall;
	wasm_user_halt_signal_handler();
	BUG(); // should never get here
}
