// SPDX-License-Identifier: GPL-2.0

#include <asm/irq.h>
#include <asm/remote_vm.h>
#include <asm/thread_info.h>
#include <asm/wasm_imports.h>
#include <linux/mm.h>
#include <linux/rcupdate.h>
#include <linux/sched/signal.h>
#include <linux/time64.h>
#include <linux/uaccess.h>

#define WASM_REMOTE_WAIT_CHUNK_NS	NSEC_PER_SEC
#define WASM_REMOTE_WAIT_TIMEOUT_NS	(5ULL * NSEC_PER_SEC)

struct wasm_remote_request {
	struct mm_struct *mm;
	unsigned long user_addr;
	void *kernel_addr;
	unsigned int len;
	bool write;
	int result;
};

/*
 * Keep each userspace WebAssembly.Memory owned by its process worker. Passing
 * Memory objects between workers exposes browser-specific wrapper refresh and
 * lifetime behavior, especially after memory growth. A foreign access instead
 * sends only a numeric request through shared kernel memory and asks the owner
 * worker to perform the copy against its local user-memory context.
 */

/*
 * Service one request using the user WebAssembly.Memory local to @task's
 * worker. This is also called while a worker owns no logical CPU, so it must
 * not use current, percpu state, allocation, the scheduler, ordinary locks, or
 * anything else that assumes normal task context.
 *
 * The mm-lifetime state word arbitrates request lifetime:
 *
 *   IDLE -> PUBLISHED -> CLAIMED -> DONE -> IDLE
 *                      \
 *                       ` requester cancellation -> IDLE
 *
 * The requester stores the pointer before release-publishing PUBLISHED. A
 * service worker must acquire-claim PUBLISHED before it may load that pointer,
 * so cancellation can safely return with a stack-backed request. The service
 * worker writes the result before release-publishing DONE; the requester reads
 * it only after an acquire load observes DONE.
 *
 * CLAIMED is irrevocable. wasm_user_read() and wasm_user_write() are
 * synchronous host imports: the servicing worker cannot schedule, exec, or
 * exit between claiming the request and publishing DONE. External worker
 * termination only occurs while the whole machine, including the requester,
 * is being torn down.
 */
void wasm_service_remote_request(struct task_struct *task)
{
	struct thread_info *ti = task_thread_info(task);
	struct wasm_remote_request *request;
	struct wasm_remote_slot *slot;
	struct mm_struct *mm;
	unsigned long not_copied;

	mm = READ_ONCE(task->mm);
	if (!mm)
		return;

	slot = &mm->context.remote;
	/* The normal syscall-entry path is one unordered mailbox-state load. */
	if (atomic_read(&slot->state) != WASM_REMOTE_PUBLISHED)
		return;
	if (READ_ONCE(ti->context_mm) != mm)
		return;
	if (atomic_cmpxchg_acquire(&slot->state, WASM_REMOTE_PUBLISHED,
				   WASM_REMOTE_CLAIMED) !=
	    WASM_REMOTE_PUBLISHED)
		return;

	request = READ_ONCE(slot->request);
	BUG_ON(!request || request->mm != mm);

	if (request->write)
		not_copied = wasm_user_write(
			(void __user *)request->user_addr,
			request->kernel_addr, request->len);
	else
		not_copied = wasm_user_read(
			request->kernel_addr,
			(const void __user *)request->user_addr, request->len);

	WRITE_ONCE(request->result,
		   request->len - min_t(unsigned long, not_copied,
					request->len));

	atomic_set_release(&slot->state, WASM_REMOTE_DONE);
	__builtin_wasm_memory_atomic_notify(&slot->state.counter, 1);
}

/*
 * Wake every user task whose worker could own this mm's local user context.
 * thread_info is embedded in the RCU-protected task_struct on wasm.
 */
static bool wasm_kick_remote_mm(struct mm_struct *mm)
{
	struct task_struct *group, *task;
	bool found = false;

	rcu_read_lock();
	for_each_process_thread(group, task) {
		struct thread_info *ti;
		int running_cpu;

		if (task->flags & PF_KTHREAD || READ_ONCE(task->mm) != mm)
			continue;

		found = true;
		ti = task_thread_info(task);
		running_cpu = atomic_cmpxchg(&ti->running_cpu,
					    WASM_CPU_PARKED,
					    WASM_CPU_REMOTE_WAKE);
		if (running_cpu == WASM_CPU_PARKED)
			__builtin_wasm_memory_atomic_notify(
				&ti->running_cpu.counter, 1);
	}
	rcu_read_unlock();

	return found;
}

static bool wasm_cancel_remote_request(struct wasm_remote_slot *slot)
{
	if (atomic_cmpxchg(&slot->state, WASM_REMOTE_PUBLISHED,
			   WASM_REMOTE_IDLE) != WASM_REMOTE_PUBLISHED)
		return false;

	/*
	 * No service worker may load the pointer without first winning the
	 * PUBLISHED -> CLAIMED CAS. The mutex prevents a new publisher until
	 * after this pointer has been cleared.
	 */
	WRITE_ONCE(slot->request, NULL);
	return true;
}

int wasm_access_remote_vm(struct mm_struct *mm, unsigned long addr, void *buf,
			  int len, unsigned int gup_flags)
{
	struct wasm_remote_request request;
	struct wasm_remote_slot *slot = &mm->context.remote;
	u64 deadline;
	int result = 0;

	if (len <= 0)
		return 0;
	len = min_t(int, len, PAGE_SIZE - offset_in_page(addr));
	if (!access_ok((void __user *)addr, len))
		return 0;

	request = (struct wasm_remote_request) {
		.mm = mm,
		.user_addr = addr,
		.kernel_addr = buf,
		.len = len,
		.write = gup_flags & FOLL_WRITE,
		.result = 0,
	};

	/*
	 * Queueing requesters sleep schedulably on the mutex. Only the single
	 * in-flight requester holds its logical CPU in a wasm atomic wait.
	 */
	mutex_lock(&slot->mutex);
	if (!slot->accepting) {
		mutex_unlock(&slot->mutex);
		return 0;
	}
	BUG_ON(atomic_read(&slot->state) != WASM_REMOTE_IDLE);
	WRITE_ONCE(slot->request, &request);
	atomic_set_release(&slot->state, WASM_REMOTE_PUBLISHED);
	deadline = wasm_kernel_get_now_nsec() + WASM_REMOTE_WAIT_TIMEOUT_NS;

	for (;;) {
		u64 timer_deadline;
		u64 now;
		s64 wait_ns;
		int state;

		/* Reciprocal A -> B and B -> A reads must make progress. */
		wasm_service_remote_request(current);

		state = atomic_read_acquire(&slot->state);
		if (state == WASM_REMOTE_DONE) {
			result = READ_ONCE(request.result);
			WRITE_ONCE(slot->request, NULL);
			atomic_set_release(&slot->state, WASM_REMOTE_IDLE);
			break;
		}

		now = wasm_kernel_get_now_nsec();
		if (state == WASM_REMOTE_PUBLISHED) {
			/*
			 * A task is visible before its asynchronously-created
			 * worker is ready, and exec temporarily makes task->mm
			 * lead context_mm. Both are live and worth retrying.
			 */
			if (!wasm_kick_remote_mm(mm) ||
			    (s64)(now - deadline) >= 0) {
				if (wasm_cancel_remote_request(slot))
					break;
				continue;
			}
			wait_ns = min_t(u64, WASM_REMOTE_WAIT_CHUNK_NS,
					deadline - now);
		} else {
			/*
			 * Once claimed, the requester must retain its stack and
			 * destination buffer until the synchronous host import
			 * publishes DONE. Claims copy at most PAGE_SIZE through
			 * a checked, non-throwing host primitive.
			 */
			BUG_ON(state != WASM_REMOTE_CLAIMED);
			wait_ns = WASM_REMOTE_WAIT_CHUNK_NS;
		}

		/*
		 * The requester retains this logical CPU while blocked. Do not
		 * let a remote copy defer an hrtimer already armed on the CPU.
		 */
		timer_deadline = wasm_get_timer_deadline();
		if (timer_deadline) {
			s64 timer_wait_ns = (s64)(timer_deadline - now);

			wait_ns = min_t(s64, wait_ns,
					max_t(s64, timer_wait_ns, 0));
		}

		__builtin_wasm_memory_atomic_wait32(&slot->state.counter,
						    state, wait_ns);
		/*
		 * This worker still owns a logical CPU while waiting. Poll its
		 * clockevent between bounded waits so timers cannot remain
		 * stalled for the duration of the remote access.
		 */
		wasm_timer_check();
	}

	mutex_unlock(&slot->mutex);
	return result;
}

void wasm_remote_mm_shutdown(struct mm_struct *mm)
{
	struct wasm_remote_slot *slot = &mm->context.remote;

	/*
	 * access_remote_vm() callers hold an mm reference. Taking the admission
	 * mutex after mm_users reaches zero therefore finds an idle slot, but
	 * also makes that lifetime rule explicit and drains any caller that
	 * reached this path with a weaker reference.
	 */
	mutex_lock(&slot->mutex);
	WRITE_ONCE(slot->accepting, false);
	WARN_ON_ONCE(atomic_read(&slot->state) != WASM_REMOTE_IDLE);
	WARN_ON_ONCE(READ_ONCE(slot->request));
	mutex_unlock(&slot->mutex);
}
