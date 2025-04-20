#include <asm/wasm_imports.h>
#include <linux/syscalls.h>

void arch_do_signal_or_restart(struct pt_regs *regs) {
	struct ksignal ksig;

	if (get_signal(&ksig)) {
		struct sigaction* sa = &ksig.ka.sa;
		if (sa->sa_flags&SA_SIGINFO)
			pr_warn("TODO: SA_SIGINFO in signal handler\n");
		wasm_user_call_signal_handler((uintptr_t)sa->sa_handler, ksig.sig);
	}
}

