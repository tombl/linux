// SPDX-License-Identifier: GPL-2.0-only

#include <linux/anon_inodes.h>
#include <linux/capability.h>
#include <linux/cred.h>
#include <linux/fdtable.h>
#include <linux/file.h>
#include <linux/fs.h>
#include <linux/hrtimer.h>
#include <linux/kref.h>
#include <linux/limits.h>
#include <linux/list.h>
#include <linux/mutex.h>
#include <linux/sched/signal.h>
#include <linux/slab.h>
#include <linux/spinlock.h>
#include <linux/syscalls.h>
#include <linux/time.h>
#include <linux/time64.h>

#define WASM_SEM_VALUE_MAX INT_MAX

struct wasm_sem {
	struct list_head registry_entry;
	struct kref refs;
	/* Protects value, waiters, and direct waiter handoff. */
	spinlock_t lock;
	struct list_head waiters;
	kuid_t uid;
	kgid_t gid;
	umode_t mode;
	unsigned int value;
	bool linked;
	char name[NAME_MAX + 1];
};

struct wasm_sem_waiter {
	struct list_head entry;
	struct task_struct *task;
	bool granted;
};

static LIST_HEAD(wasm_sem_registry);
static DEFINE_MUTEX(wasm_sem_registry_lock);

static void wasm_sem_free(struct kref *ref)
{
	struct wasm_sem *sem = container_of(ref, struct wasm_sem, refs);

	kfree(sem);
}

static int wasm_sem_release(struct inode *inode, struct file *file)
{
	struct wasm_sem *sem = file->private_data;

	kref_put(&sem->refs, wasm_sem_free);
	return 0;
}

static const struct file_operations wasm_sem_fops = {
	.release = wasm_sem_release,
};

static int wasm_sem_copy_name(const char __user *user_name,
			      char name[NAME_MAX + 1])
{
	char buffer[NAME_MAX + 2];
	char *canonical;
	long length;

	length = strncpy_from_user(buffer, user_name, sizeof(buffer));
	if (length < 0)
		return length;
	if (length == sizeof(buffer))
		return -ENAMETOOLONG;

	canonical = buffer;
	while (*canonical == '/')
		canonical++;
	if (!*canonical || strchr(canonical, '/') ||
	    !strcmp(canonical, ".") || !strcmp(canonical, ".."))
		return -EINVAL;
	if (strlen(canonical) > NAME_MAX)
		return -ENAMETOOLONG;

	strscpy(name, canonical, NAME_MAX + 1);
	return 0;
}

static struct wasm_sem *wasm_sem_find(const char *name)
{
	struct wasm_sem *sem;

	list_for_each_entry(sem, &wasm_sem_registry, registry_entry) {
		if (!strcmp(sem->name, name))
			return sem;
	}
	return NULL;
}

static bool wasm_sem_may_open(const struct wasm_sem *sem)
{
	umode_t granted = sem->mode;

	if (uid_eq(current_fsuid(), sem->uid))
		granted >>= 6;
	else if (in_group_p(sem->gid))
		granted >>= 3;

	return (granted & 06) == 06 || capable(CAP_DAC_OVERRIDE);
}

static bool wasm_sem_may_unlink(const struct wasm_sem *sem)
{
	return uid_eq(current_fsuid(), sem->uid) || capable(CAP_FOWNER);
}

static struct wasm_sem *wasm_sem_from_fd(int fd, struct fd *f)
{
	*f = fdget(fd);
	if (!f->file)
		return ERR_PTR(-EBADF);
	if (f->file->f_op != &wasm_sem_fops) {
		fdput(*f);
		return ERR_PTR(-EINVAL);
	}
	return f->file->private_data;
}

SYSCALL_DEFINE4(wasm_sem_open, const char __user *, user_name, int, flags,
		umode_t, mode, unsigned int, value)
{
	char name[NAME_MAX + 1];
	struct wasm_sem *sem;
	bool created = false;
	int fd;
	int error;

	if (flags & ~(O_CREAT | O_EXCL))
		return -EINVAL;
	if ((flags & O_EXCL) && !(flags & O_CREAT))
		return -EINVAL;

	error = wasm_sem_copy_name(user_name, name);
	if (error)
		return error;

	mutex_lock(&wasm_sem_registry_lock);
	sem = wasm_sem_find(name);
	if (sem) {
		if ((flags & (O_CREAT | O_EXCL)) == (O_CREAT | O_EXCL)) {
			error = -EEXIST;
			goto out_unlock;
		}
		if (!wasm_sem_may_open(sem)) {
			error = -EACCES;
			goto out_unlock;
		}
	} else {
		if (!(flags & O_CREAT)) {
			error = -ENOENT;
			goto out_unlock;
		}
		if (value > WASM_SEM_VALUE_MAX) {
			error = -EINVAL;
			goto out_unlock;
		}

		sem = kzalloc(sizeof(*sem), GFP_KERNEL);
		if (!sem) {
			error = -ENOMEM;
			goto out_unlock;
		}
		INIT_LIST_HEAD(&sem->registry_entry);
		INIT_LIST_HEAD(&sem->waiters);
		kref_init(&sem->refs);
		spin_lock_init(&sem->lock);
		sem->uid = current_fsuid();
		sem->gid = current_fsgid();
		sem->mode = mode & ~current_umask() & 0777;
		sem->value = value;
		sem->linked = true;
		strscpy(sem->name, name, sizeof(sem->name));
		list_add_tail(&sem->registry_entry, &wasm_sem_registry);
		created = true;
	}

	kref_get(&sem->refs);
	fd = anon_inode_getfd("[wasm-sem]", &wasm_sem_fops, sem,
			      O_RDWR | O_CLOEXEC);
	if (fd >= 0) {
		mutex_unlock(&wasm_sem_registry_lock);
		return fd;
	}

	kref_put(&sem->refs, wasm_sem_free);
	if (created) {
		list_del(&sem->registry_entry);
		sem->linked = false;
		kref_put(&sem->refs, wasm_sem_free);
	}
	error = fd;
out_unlock:
	mutex_unlock(&wasm_sem_registry_lock);
	return error;
}

SYSCALL_DEFINE1(wasm_sem_unlink, const char __user *, user_name)
{
	char name[NAME_MAX + 1];
	struct wasm_sem *sem;
	int error;

	error = wasm_sem_copy_name(user_name, name);
	if (error)
		return error;

	mutex_lock(&wasm_sem_registry_lock);
	sem = wasm_sem_find(name);
	if (!sem) {
		error = -ENOENT;
		goto out_unlock;
	}
	if (!wasm_sem_may_unlink(sem)) {
		error = -EACCES;
		goto out_unlock;
	}

	list_del(&sem->registry_entry);
	sem->linked = false;
	mutex_unlock(&wasm_sem_registry_lock);
	kref_put(&sem->refs, wasm_sem_free);
	return 0;

out_unlock:
	mutex_unlock(&wasm_sem_registry_lock);
	return error;
}

static int wasm_sem_do_wait(struct wasm_sem *sem, bool try,
			    ktime_t *expires)
{
	struct wasm_sem_waiter waiter = {
		.task = current,
	};
	unsigned long irq_flags;
	int schedule_result;
	int error;

	spin_lock_irqsave(&sem->lock, irq_flags);
	if (sem->value) {
		sem->value--;
		spin_unlock_irqrestore(&sem->lock, irq_flags);
		return 0;
	}
	if (try) {
		spin_unlock_irqrestore(&sem->lock, irq_flags);
		return -EAGAIN;
	}

	INIT_LIST_HEAD(&waiter.entry);
	list_add_tail(&waiter.entry, &sem->waiters);
	for (;;) {
		set_current_state(TASK_INTERRUPTIBLE);
		if (signal_pending(current)) {
			error = -ERESTARTSYS;
			break;
		}
		spin_unlock_irqrestore(&sem->lock, irq_flags);
		schedule_result =
			schedule_hrtimeout_range_clock(expires, 0,
						       HRTIMER_MODE_ABS,
						       CLOCK_REALTIME);
		spin_lock_irqsave(&sem->lock, irq_flags);

		if (waiter.granted) {
			error = 0;
			break;
		}
		if (signal_pending(current)) {
			error = -ERESTARTSYS;
			break;
		}
		if (expires && schedule_result == 0) {
			error = -ETIMEDOUT;
			break;
		}
	}
	if (!waiter.granted)
		list_del(&waiter.entry);
	__set_current_state(TASK_RUNNING);
	spin_unlock_irqrestore(&sem->lock, irq_flags);
	return error;
}

static int wasm_sem_wait_fd(int fd, bool try, ktime_t *expires)
{
	struct wasm_sem *sem;
	struct fd f;
	int error;

	sem = wasm_sem_from_fd(fd, &f);
	if (IS_ERR(sem))
		return PTR_ERR(sem);
	error = wasm_sem_do_wait(sem, try, expires);
	fdput(f);
	return error;
}

SYSCALL_DEFINE1(wasm_sem_wait, int, fd)
{
	return wasm_sem_wait_fd(fd, false, NULL);
}

SYSCALL_DEFINE1(wasm_sem_trywait, int, fd)
{
	return wasm_sem_wait_fd(fd, true, NULL);
}

SYSCALL_DEFINE2(wasm_sem_timedwait, int, fd,
		const struct __kernel_timespec __user *, user_expires)
{
	struct wasm_sem *sem;
	struct timespec64 expires_ts;
	ktime_t expires;
	struct fd f;
	int error;

	sem = wasm_sem_from_fd(fd, &f);
	if (IS_ERR(sem))
		return PTR_ERR(sem);

	spin_lock_irq(&sem->lock);
	if (sem->value) {
		sem->value--;
		spin_unlock_irq(&sem->lock);
		fdput(f);
		return 0;
	}
	spin_unlock_irq(&sem->lock);

	if (get_timespec64(&expires_ts, user_expires)) {
		error = -EFAULT;
		goto out_fdput;
	}
	if (!timespec64_valid(&expires_ts)) {
		error = -EINVAL;
		goto out_fdput;
	}
	expires = timespec64_to_ktime(expires_ts);
	error = wasm_sem_do_wait(sem, false, &expires);
out_fdput:
	fdput(f);
	return error;
}

SYSCALL_DEFINE1(wasm_sem_post, int, fd)
{
	struct wasm_sem_waiter *waiter;
	struct wasm_sem *sem;
	unsigned long irq_flags;
	struct fd f;
	int error = 0;

	sem = wasm_sem_from_fd(fd, &f);
	if (IS_ERR(sem))
		return PTR_ERR(sem);

	spin_lock_irqsave(&sem->lock, irq_flags);
	if (!list_empty(&sem->waiters)) {
		waiter = list_first_entry(&sem->waiters,
					  struct wasm_sem_waiter, entry);
		list_del_init(&waiter->entry);
		waiter->granted = true;
		wake_up_process(waiter->task);
	} else if (sem->value == WASM_SEM_VALUE_MAX) {
		error = -EOVERFLOW;
	} else {
		sem->value++;
	}
	spin_unlock_irqrestore(&sem->lock, irq_flags);
	fdput(f);
	return error;
}

SYSCALL_DEFINE1(wasm_sem_getvalue, int, fd)
{
	struct wasm_sem *sem;
	unsigned long irq_flags;
	unsigned int value;
	struct fd f;

	sem = wasm_sem_from_fd(fd, &f);
	if (IS_ERR(sem))
		return PTR_ERR(sem);

	spin_lock_irqsave(&sem->lock, irq_flags);
	value = sem->value;
	spin_unlock_irqrestore(&sem->lock, irq_flags);
	fdput(f);
	return value;
}
