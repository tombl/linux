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
	struct task_struct *from_sched;
#ifdef CONFIG_SMP
	unsigned int cpu;
#endif
};

#define INIT_THREAD_INFO(tsk)                                                  \
	{                                                                      \
		.task = &tsk, .flags = 0, .preempt_count = INIT_PREEMPT_COUNT, \
	}

extern unsigned long *__stack_pointer;
#define current_stack_pointer __stack_pointer

#define TIF_SYSCALL_TRACE 0 /* syscall trace active */
#define TIF_NOTIFY_RESUME 1 /* resumption notification requested */
#define TIF_SIGPENDING 2 /* signal pending */
#define TIF_NEED_RESCHED 3 /* rescheduling necessary */
#define TIF_NOTIFY_SIGNAL 7 /* signal notifications exist */
#define TIF_MEMDIE 17 /* OOM killer killed process */

#define _TIF_SYSCALL_TRACE (1 << TIF_SYSCALL_TRACE)
#define _TIF_NOTIFY_RESUME (1 << TIF_NOTIFY_RESUME)
#define _TIF_SIGPENDING (1 << TIF_SIGPENDING)
#define _TIF_NEED_RESCHED (1 << TIF_NEED_RESCHED)
#define _TIF_NOTIFY_SIGNAL (1 << TIF_NOTIFY_SIGNAL)

#endif
