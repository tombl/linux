#ifndef _WASM_THREAD_INFO_H
#define _WASM_THREAD_INFO_H

// THREAD_SIZE is the size of the task_struct+kernel stack
// wasm stores stacks outside of addressable memory, plus its page size is 64KiB
// so that'll be big enough
#define THREAD_SIZE PAGE_SIZE
#define THREAD_SIZE_ORDER 0

struct thread_info {
	struct task_struct *task;
	unsigned long flags;
	int preempt_count;
	unsigned int worker;
};

#define INIT_THREAD_INFO(tsk)                                 \
	{                                                     \
		.task = &tsk, .flags = 0, .preempt_count = 1, \
	}

extern unsigned long *__stack_pointer;
#define current_stack_pointer __stack_pointer

#define TIF_SYSCALL_TRACE 0 /* syscall trace active */
#define TIF_NOTIFY_RESUME 1 /* callback before returning to user */
#define TIF_SIGPENDING 2 /* signal pending */
#define TIF_NEED_RESCHED 3 /* rescheduling necessary */
#define TIF_SINGLESTEP 4 /* reenable singlestep on user return*/
#define TIF_SSBD 5 /* Speculative store bypass disable */
#define TIF_SPEC_IB 9 /* Indirect branch speculation mitigation */
#define TIF_SPEC_L1D_FLUSH 10 /* Flush L1D on mm switches (processes) */
#define TIF_USER_RETURN_NOTIFY 11 /* notify kernel of userspace return */
#define TIF_UPROBE 12 /* breakpointed or singlestepping */
#define TIF_PATCH_PENDING 13 /* pending live patching update */
#define TIF_NEED_FPU_LOAD 14 /* load FPU on return to userspace */
#define TIF_NOCPUID 15 /* CPUID is not accessible in userland */
#define TIF_NOTSC 16 /* TSC is not accessible in userland */
#define TIF_NOTIFY_SIGNAL 17 /* signal notifications exist */
#define TIF_MEMDIE 20 /* is terminating due to OOM killer */
#define TIF_POLLING_NRFLAG 21 /* idle is polling for TIF_NEED_RESCHED */
#define TIF_IO_BITMAP 22 /* uses I/O bitmap */
#define TIF_SPEC_FORCE_UPDATE \
	23 /* Force speculation MSR update in context switch */
#define TIF_FORCED_TF 24 /* true if TF in eflags artificially */
#define TIF_BLOCKSTEP 25 /* set when we want DEBUGCTLMSR_BTF */
#define TIF_LAZY_MMU_UPDATES 27 /* task is updating the mmu lazily */
#define TIF_ADDR32 29 /* 32-bit address space on 64 bits */

#define _TIF_SYSCALL_TRACE (1 << TIF_SYSCALL_TRACE)
#define _TIF_NOTIFY_RESUME (1 << TIF_NOTIFY_RESUME)
#define _TIF_SIGPENDING (1 << TIF_SIGPENDING)
#define _TIF_NEED_RESCHED (1 << TIF_NEED_RESCHED)
#define _TIF_SINGLESTEP (1 << TIF_SINGLESTEP)
#define _TIF_SSBD (1 << TIF_SSBD)
#define _TIF_SPEC_IB (1 << TIF_SPEC_IB)
#define _TIF_SPEC_L1D_FLUSH (1 << TIF_SPEC_L1D_FLUSH)
#define _TIF_USER_RETURN_NOTIFY (1 << TIF_USER_RETURN_NOTIFY)
#define _TIF_UPROBE (1 << TIF_UPROBE)
#define _TIF_PATCH_PENDING (1 << TIF_PATCH_PENDING)
#define _TIF_NEED_FPU_LOAD (1 << TIF_NEED_FPU_LOAD)
#define _TIF_NOCPUID (1 << TIF_NOCPUID)
#define _TIF_NOTSC (1 << TIF_NOTSC)
#define _TIF_NOTIFY_SIGNAL (1 << TIF_NOTIFY_SIGNAL)
#define _TIF_POLLING_NRFLAG (1 << TIF_POLLING_NRFLAG)
#define _TIF_IO_BITMAP (1 << TIF_IO_BITMAP)
#define _TIF_SPEC_FORCE_UPDATE (1 << TIF_SPEC_FORCE_UPDATE)
#define _TIF_FORCED_TF (1 << TIF_FORCED_TF)
#define _TIF_BLOCKSTEP (1 << TIF_BLOCKSTEP)
#define _TIF_LAZY_MMU_UPDATES (1 << TIF_LAZY_MMU_UPDATES)
#define _TIF_ADDR32 (1 << TIF_ADDR32)

#endif
