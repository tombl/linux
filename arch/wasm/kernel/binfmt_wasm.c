#define pr_fmt(fmt) KBUILD_MODNAME ": " fmt

#include <linux/auxvec.h>
#include <linux/binfmts.h>
#include <linux/cred.h>
#include <linux/highmem.h>
#include <linux/jiffies.h>
#include <linux/mm.h>
#include <linux/overflow.h>
#include <linux/personality.h>
#include <linux/ptrace.h>
#include <linux/random.h>
#include <linux/sched/signal.h>
#include <linux/sizes.h>
#include <linux/slab.h>
#include <linux/syscalls.h>

/* Four pages amortize host calls without requiring a large kernel allocation. */
#define WASM_EXEC_MAX_CHUNK_SIZE SZ_256K
#define WASM_ARG_LIMIT SZ_256K
#define WASM32_MAX_MEMORY_PAGES (1U << (32 - PAGE_SHIFT))

/*
 * binfmt_wasm hands userland its arguments through a flat blob rather than the
 * ELF stack, so nothing would otherwise supply an auxiliary vector. Unpatched
 * musl still walks for one immediately past envp[]'s NULL terminator, so we lay
 * a real auxv there (see copy_args). AT_RANDOM's 16 bytes live in the blob just
 * after the vector.
 */
#define WASM_AT_RANDOM_SIZE 16

/*
 * The process_args member is the userspace ABI. Everything before it is
 * kernel-private exec state, and process_size is the exact byte range copied
 * to userspace.
 */
struct wasm_process_args {
	int len, envc, argc;
	char **argv, **envp;
	char data[];
};

struct wasm_exec_args {
	size_t process_size;
	size_t arg_start;
	size_t arg_end;
	size_t env_start;
	size_t env_end;
	size_t auxv;
	size_t random;
	size_t execfn;
	int execfd;
	unsigned int secureexec : 1;
	unsigned int preserve_argv0 : 1;
	unsigned int have_execfd : 1;
	struct wasm_process_args process;
};

static int load_wasm_binary(struct linux_binprm *bprm);

static u32 user_memory_limit_pages(void)
{
	unsigned long limit = rlimit(RLIMIT_AS);

	/* WebAssembly memory limits are an intentional exec-time snapshot. */
	return limit == RLIM_INFINITY ? WASM32_MAX_MEMORY_PAGES :
				       limit / SZ_64K;
}

static struct linux_binfmt wasm_format = {
	.module = THIS_MODULE,
	.load_binary = load_wasm_binary,
};

static int file_get_size(struct file *f, loff_t *size)
{
	struct kstat stat;
	int ret = vfs_getattr(&f->f_path, &stat, STATX_SIZE,
			      AT_STATX_SYNC_AS_STAT);
	if (ret)
		return ret;
	*size = stat.size;
	return 0;
}

static size_t process_offset(struct wasm_exec_args *exec, const void *ptr)
{
	return (const char *)ptr - (const char *)&exec->process;
}

static int consume_string(char **cursor, const char *end)
{
	size_t available = end - *cursor;
	size_t limit = min_t(size_t, available, MAX_ARG_STRLEN);
	size_t len = strnlen(*cursor, limit);

	if (len == limit)
		return -EINVAL;
	*cursor += len + 1;
	return 0;
}

static int copy_args(struct linux_binprm *bprm)
{
	const size_t argument_bytes = MAX_ARG_PAGES * PAGE_SIZE;
	size_t strings_size;
	size_t pointer_count;
	size_t pointer_size;
	size_t auxv_size = sizeof(bprm->mm->saved_auxv);
	size_t data_size;
	size_t process_size;
	struct wasm_exec_args *exec;
	struct wasm_process_args *args;
	char *strings, *cursor, *end;
	int stop = bprm->p >> PAGE_SHIFT;
	int ret;

	if (bprm->p > argument_bytes)
		return -E2BIG;
	strings_size = argument_bytes - bprm->p;

	pointer_count = size_add((size_t)bprm->argc, (size_t)bprm->envc);
	pointer_count = size_add(pointer_count, 2);
	pointer_size = array_size(pointer_count, sizeof(char *));
	data_size = size_add(pointer_size, auxv_size);
	data_size = size_add(data_size, WASM_AT_RANDOM_SIZE);
	data_size = size_add(data_size, strings_size);
	process_size = size_add(sizeof(struct wasm_process_args), data_size);
	if (process_size == SIZE_MAX || process_size > WASM_ARG_LIMIT)
		return -E2BIG;
	if (bprm->exec < bprm->p ||
	    bprm->exec - bprm->p >= strings_size)
		return -E2BIG;

	exec = kzalloc(struct_size(exec, process.data, data_size), GFP_KERNEL);
	if (!exec)
		return -ENOMEM;
	args = &exec->process;

	exec->process_size = process_size;
	exec->auxv = process_offset(exec, args->data + pointer_size);
	exec->random = exec->auxv + auxv_size;
	exec->execfn = exec->random + WASM_AT_RANDOM_SIZE +
		       bprm->exec - bprm->p;
	exec->secureexec = bprm->secureexec;
	exec->preserve_argv0 =
		bprm->interp_flags & BINPRM_FLAGS_PRESERVE_ARGV0;
	exec->have_execfd = bprm->have_execfd;
	exec->execfd = bprm->execfd;

	args->argc = bprm->argc;
	args->envc = bprm->envc;
	args->len = data_size;
	args->argv = (char **)args->data;
	args->envp = args->argv + args->argc + 1;

	strings = (char *)&exec->process + exec->random +
		  WASM_AT_RANDOM_SIZE;
	cursor = strings + strings_size;
	for (int index = MAX_ARG_PAGES - 1; index >= stop; index--) {
		unsigned int offset = index == stop ?
					      bprm->p & ~PAGE_MASK :
					      0;
		size_t size = PAGE_SIZE - offset;
		char *src = kmap_local_page(bprm->page[index]) + offset;

		cursor -= size;
		memcpy(cursor, src, size);
		kunmap_local(src);
	}
	if (WARN_ON_ONCE(cursor != strings)) {
		ret = -EINVAL;
		goto err;
	}

	get_random_bytes((char *)&exec->process + exec->random,
			 WASM_AT_RANDOM_SIZE);

	end = strings + strings_size;
	exec->arg_start = process_offset(exec, cursor);
	for (int i = 0; i < args->argc; i++) {
		args->argv[i] = cursor;
		ret = consume_string(&cursor, end);
		if (ret)
			goto err;
	}
	args->argv[args->argc] = NULL;
	exec->arg_end = process_offset(exec, cursor);

	exec->env_start = process_offset(exec, cursor);
	for (int i = 0; i < args->envc; i++) {
		args->envp[i] = cursor;
		ret = consume_string(&cursor, end);
		if (ret)
			goto err;
	}
	args->envp[args->envc] = NULL;
	exec->env_end = process_offset(exec, cursor);

	if (exec->execfn >= exec->process_size) {
		ret = -EINVAL;
		goto err;
	}

	bprm->mm->context.exec_args = exec;
	return 0;

err:
	kfree(exec);
	return ret;
}

static void create_wasm_auxv(unsigned long *auxv,
			     struct wasm_exec_args *exec,
			     unsigned long user_base)
{
	const struct cred *cred = current_cred();
	unsigned long flags = 0;

	memset(auxv, 0, sizeof(current->mm->saved_auxv));

#define NEW_AUX_ENT(id, val) \
	do { \
		*auxv++ = (id); \
		*auxv++ = (val); \
	} while (0)
	NEW_AUX_ENT(AT_HWCAP, 0);
	NEW_AUX_ENT(AT_PAGESZ, PAGE_SIZE);
	NEW_AUX_ENT(AT_CLKTCK, CLOCKS_PER_SEC);
	if (exec->preserve_argv0)
		flags |= AT_FLAGS_PRESERVE_ARGV0;
	NEW_AUX_ENT(AT_FLAGS, flags);
	NEW_AUX_ENT(AT_UID, from_kuid_munged(cred->user_ns, cred->uid));
	NEW_AUX_ENT(AT_EUID, from_kuid_munged(cred->user_ns, cred->euid));
	NEW_AUX_ENT(AT_GID, from_kgid_munged(cred->user_ns, cred->gid));
	NEW_AUX_ENT(AT_EGID, from_kgid_munged(cred->user_ns, cred->egid));
	NEW_AUX_ENT(AT_SECURE, exec->secureexec);
	NEW_AUX_ENT(AT_RANDOM, user_base + exec->random);
	NEW_AUX_ENT(AT_EXECFN, user_base + exec->execfn);
	if (exec->have_execfd)
		NEW_AUX_ENT(AT_EXECFD, exec->execfd);
	NEW_AUX_ENT(AT_NULL, 0);
#undef NEW_AUX_ENT
}

static void relocate_args(struct wasm_exec_args *exec,
			  struct wasm_process_args *args,
			  unsigned long user_base)
{
	struct wasm_process_args *template = &exec->process;
	char **argv = (void *)args + process_offset(exec, template->argv);
	char **envp = (void *)args + process_offset(exec, template->envp);

	for (int i = 0; i < template->argc; i++)
		argv[i] = (char *)(user_base +
				   process_offset(exec, template->argv[i]));
	for (int i = 0; i < template->envc; i++)
		envp[i] = (char *)(user_base +
				   process_offset(exec, template->envp[i]));
	args->argv = (char **)(user_base +
			       process_offset(exec, template->argv));
	args->envp = (char **)(user_base +
			       process_offset(exec, template->envp));
}

SYSCALL_DEFINE2(wasm_get_args, void __user *, buf, size_t, len)
{
	struct mm_struct *mm = current->mm;
	struct wasm_exec_args *exec;
	struct wasm_process_args *args;
	unsigned long *auxv;
	unsigned long user_base = (unsigned long)buf;
	int ret;

	exec = xchg(&mm->context.exec_args, NULL);
	if (!exec)
		return -EINVAL;
	if (len < exec->process_size) {
		ret = -E2BIG;
		goto restore;
	}
	if (!access_ok(buf, exec->process_size)) {
		ret = -EFAULT;
		goto restore;
	}

	args = kmemdup(&exec->process, exec->process_size, GFP_KERNEL);
	if (!args) {
		ret = -ENOMEM;
		goto restore;
	}
	auxv = (void *)args + exec->auxv;
	create_wasm_auxv(auxv, exec, user_base);
	relocate_args(exec, args, user_base);
	if (copy_to_user(buf, args, exec->process_size)) {
		ret = -EFAULT;
		goto free_args;
	}

	spin_lock(&mm->arg_lock);
	memcpy(mm->saved_auxv, auxv, sizeof(mm->saved_auxv));
	mm->arg_start = user_base + exec->arg_start;
	mm->arg_end = user_base + exec->arg_end;
	mm->env_start = user_base + exec->env_start;
	mm->env_end = user_base + exec->env_end;
	spin_unlock(&mm->arg_lock);

	kfree(args);
	kfree(exec);
	return 0;

free_args:
	kfree(args);
restore:
	WRITE_ONCE(mm->context.exec_args, exec);
	return ret;
}

static int load_wasm_binary(struct linux_binprm *bprm)
{
	loff_t offset = 0;
	u8 *chunk = NULL;
	int ret;
	loff_t filesize;
	bool compiling = false;
	u32 chunk_size;

	if (strncmp(bprm->buf, "\0asm\1\0\0\0", 8))
		return -ENOEXEC;

	ret = file_get_size(bprm->file, &filesize);
	if (ret < 0)
		return ret;
	if (filesize > U32_MAX)
		return -EFBIG;

	chunk_size = min_t(loff_t, filesize, WASM_EXEC_MAX_CHUNK_SIZE);
	chunk = kmalloc(chunk_size, GFP_KERNEL);
	if (!chunk)
		return -ENOMEM;

	ret = wasm_user_compile_begin((u32)filesize);
	if (ret)
		goto err;
	compiling = true;

	while (offset < filesize) {
		u32 size = min_t(loff_t, filesize - offset, chunk_size);
		loff_t chunk_offset = offset;
		ssize_t read = kernel_read(bprm->file, chunk, size, &offset);

		if (read < 0) {
			ret = read;
			goto err;
		}
		if (!read) {
			ret = -EIO;
			goto err;
		}
		ret = wasm_user_compile_write(chunk, (u32)chunk_offset,
					      (u32)read);
		if (ret)
			goto err;
	}

	ret = wasm_user_compile_end(user_memory_limit_pages());
	if (ret)
		goto err;

	kfree(chunk);
	chunk = NULL;

	ret = copy_args(bprm);
	if (ret)
		goto err;

	ret = begin_new_exec(bprm);
	if (ret)
		goto err;
	// point of no return starts here

	set_personality(PER_LINUX_32BIT);
	setup_new_exec(bprm);

	set_binfmt(&wasm_format);

	finalize_exec(bprm);

	wasm_user_instantiate(true);
	/*
	 * begin_new_exec() installs current->mm before the JS worker swaps its
	 * local user memory. Publish readiness only after instantiate returns,
	 * so remote access cannot copy through the old memory during exec.
	 */
	WRITE_ONCE(current_thread_info()->context_mm, current->mm);

	return 0;
err:
	if (compiling)
		wasm_user_compile_abort();
	kfree(chunk);
	return ret;
}

static int __init init_wasm_binfmt(void)
{
	register_binfmt(&wasm_format);
	return 0;
}
core_initcall(init_wasm_binfmt);
