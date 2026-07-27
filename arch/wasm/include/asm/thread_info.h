#ifndef _WASM_THREAD_INFO_H
#define _WASM_THREAD_INFO_H

#include <asm/page.h>
#include <linux/types.h>

struct kernel_siginfo;
struct mm_struct;

/*
 * A remote wake changes the value parked workers wait on, so publishing a
 * request cannot race between their mailbox check and atomic.wait().
 */
#define WASM_CPU_PARKED		(-1)
#define WASM_CPU_REMOTE_WAKE	(-2)

/* THREAD_SIZE is the size of the task_struct + kernel stack
 * This is asserted in setup, but the stack should be 1 page,
 * and a task_struct should be *way* less than a page big. */
#define THREAD_SIZE_ORDER 1
#define THREAD_SIZE (PAGE_SIZE << THREAD_SIZE_ORDER)
#define THREAD_SHIFT (PAGE_SHIFT << THREAD_SIZE_ORDER)

struct thread_info {
	unsigned long flags;
	unsigned long syscall_work; /* SYSCALL_WORK_ flags */
	int preempt_count;
	int cpu; // this is for the kernel
	atomic_t running_cpu; // negative means unscheduled
	/* The mm represented by this worker's local JS user context. */
	struct mm_struct *context_mm;
	unsigned long tp_value;
	const struct kernel_siginfo *active_siginfo;
};

#ifndef current_thread_info
#include <asm/current.h>
#define current_thread_info() ((struct thread_info *)current)
#endif

#define INIT_THREAD_INFO(tsk)                        \
	{                                            \
		.flags = 0,                          \
		.preempt_count = INIT_PREEMPT_COUNT, \
		.cpu = 0,                            \
		.running_cpu = ATOMIC_INIT(0),       \
		.context_mm = NULL,                  \
		.tp_value = U32_MAX,                 \
		.active_siginfo = NULL,              \
	}

#include <asm-generic/thread_info_tif.h>

#endif
