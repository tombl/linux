#define pr_fmt(fmt) KBUILD_MODNAME ": " fmt

#include <linux/auxvec.h>
#include <linux/binfmts.h>
#include <linux/cred.h>
#include <linux/highmem.h>
#include <linux/mm.h>
#include <linux/jiffies.h>
#include <linux/personality.h>
#include <linux/ptrace.h>
#include <linux/random.h>
#include <linux/sched/signal.h>
#include <linux/sizes.h>
#include <linux/slab.h>

/* Four pages amortize host calls without requiring a large kernel allocation. */
#define WASM_EXEC_MAX_CHUNK_SIZE SZ_256K
#define WASM32_MAX_MEMORY_PAGES (1U << (32 - PAGE_SHIFT))

/*
 * binfmt_wasm hands userland its arguments through a flat blob rather than the
 * ELF stack, so nothing would otherwise supply an auxiliary vector. Unpatched
 * musl still walks for one immediately past envp[]'s NULL terminator, so we lay
 * a real auxv there (see copy_args). WASM_AUXV_PAIRS counts the id/value pairs
 * emitted below, including the AT_NULL terminator; keep it in sync with the
 * PUT_AUX() list. AT_RANDOM's 16 bytes live in the blob just after the vector.
 */
#define WASM_AUXV_PAIRS 10
#define WASM_AT_RANDOM_SIZE 16

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

static int copy_args(struct linux_binprm *bprm)
{
	const struct cred *cred = bprm->cred;
	struct wasm_process_args *args;
	int stop = bprm->p >> PAGE_SHIFT;
	int ptr_bytes = (bprm->argc + bprm->envc + 2) * sizeof(char *);
	int aux_bytes = WASM_AUXV_PAIRS * 2 * sizeof(size_t) + WASM_AT_RANDOM_SIZE;
	int len = ptr_bytes + aux_bytes +
		  (PAGE_SIZE * (MAX_ARG_PAGES - stop)) + (bprm->p & ~PAGE_MASK);
	unsigned char *rand;
	size_t *auxv;
	char *data;
	int slen;
	int a = 0;
	int ret;

	args = kmalloc(sizeof(*args) + len, GFP_KERNEL);
	if (!args)
		return -ENOMEM;

	args->argc = bprm->argc;
	args->envc = bprm->envc;
	args->len = len;

	/*
	 * Strings are copied to the tail of data[]; the pointer arrays sit at
	 * the front. Growing len by aux_bytes therefore frees exactly the span
	 * between envp[]'s NULL and the strings for the auxv laid out below.
	 */
	data = args->data + len;
	for (int index = MAX_ARG_PAGES - 1; index >= stop; index--) {
		unsigned int offset = index == stop ? bprm->p & ~PAGE_MASK : 0;
		char *src = kmap_local_page(bprm->page[index]) + offset;

		data -= PAGE_SIZE - offset;
		memcpy(data, src, PAGE_SIZE - offset);
		kunmap_local(src);
	}

	args->argv = (char **)(args->data);
	for (int i = 0; i < bprm->argc; i++) {
		slen = strnlen(data, MAX_ARG_STRLEN);
		if (!slen || slen > MAX_ARG_STRLEN) {
			ret = -EINVAL;
			goto err;
		}
		args->argv[i] = data;
		data += slen + 1;
	}
	args->argv[bprm->argc] = NULL;

	args->envp = args->argv + bprm->argc + 1;
	for (int i = 0; i < bprm->envc; i++) {
		slen = strnlen(data, MAX_ARG_STRLEN);
		if (!slen || slen > MAX_ARG_STRLEN) {
			ret = -EINVAL;
			goto err;
		}
		args->envp[i] = data;
		data += slen + 1;
	}
	args->envp[bprm->envc] = NULL;

	/*
	 * Lay a real ELF-style auxiliary vector immediately after envp[]'s NULL
	 * terminator, where unpatched musl's __init_libc already walks for it.
	 * The pointer arrays are pointer-aligned, and on wasm32 a size_t is the
	 * same width as a pointer, so the vector is naturally aligned. The 16
	 * AT_RANDOM bytes live in the blob right after the vector; get_args()
	 * relocates that pointer along with argv/envp. Only entries meaningful
	 * on wasm are emitted (no AT_PHDR/AT_BASE/AT_ENTRY/AT_EXECFN).
	 */
	auxv = (size_t *)(args->envp + bprm->envc + 1);
	rand = (unsigned char *)(auxv + WASM_AUXV_PAIRS * 2);
	get_random_bytes(rand, WASM_AT_RANDOM_SIZE);

#define PUT_AUX(id, val)                   \
	do {                               \
		auxv[a++] = (id);          \
		auxv[a++] = (size_t)(val); \
	} while (0)
	PUT_AUX(AT_HWCAP, 0);
	PUT_AUX(AT_PAGESZ, PAGE_SIZE);
	PUT_AUX(AT_CLKTCK, CLOCKS_PER_SEC);
	PUT_AUX(AT_UID, from_kuid_munged(cred->user_ns, cred->uid));
	PUT_AUX(AT_EUID, from_kuid_munged(cred->user_ns, cred->euid));
	PUT_AUX(AT_GID, from_kgid_munged(cred->user_ns, cred->gid));
	PUT_AUX(AT_EGID, from_kgid_munged(cred->user_ns, cred->egid));
	PUT_AUX(AT_SECURE, bprm->secureexec);
	PUT_AUX(AT_RANDOM, (unsigned long)rand);
	PUT_AUX(AT_NULL, 0);
#undef PUT_AUX

	/*
	 * Capture a kernel-side cmdline copy while argv[] still points at the
	 * pristine blob, before get_args() relocates those pointers into wasm
	 * linear memory. save_cmdline() hands this to mm->context so that
	 * /proc/<pid>/cmdline can read it (the blob is gone by then).
	 */
	{
		char *buf, *p;
		int total = 0, i;

		for (i = 0; i < args->argc; i++)
			total += strnlen(args->argv[i], MAX_ARG_STRLEN) + 1;

		buf = total ? kmalloc(total, GFP_KERNEL) : NULL;
		if (buf) {
			p = buf;
			for (i = 0; i < args->argc; i++) {
				char *src = args->argv[i];
				int n = strnlen(src, MAX_ARG_STRLEN) + 1;
				memcpy(p, src, n);
				/*
				 * Display-only normalisation: on wasm the kernel
				 * occasionally stores argv[0]'s first byte with its
				 * high bit set (observed 0xE8 where the genuine byte
				 * is 'h' = 0x68). The running program tolerates this,
				 * so we leave the program's argv[] untouched and only
				 * fix it in this captured copy that backs
				 * /proc/<pid>/cmdline. Clearing it in the live argv
				 * instead made NOMMU daemonize re-exec (execv(argv[0]))
				 * resolve to a real "httpd" and loop forever.
				 */
				if (i == 0 && (p[0] & 0x80))
					p[0] &= 0x7f;
				p += n;
			}
			args->cmdline = buf;
			args->cmdline_len = total;
		}
	}

	current_thread_info()->args = args;
	return 0;
err:
	kfree(args);
	return ret;
}

__attribute__((export_name("get_args_length"))) int get_args_length(void)
{
	struct wasm_process_args *args = current_thread_info()->args;
	return args ? sizeof(*args) + args->len : -EINVAL;
}

/*
 * Once the blob lands at 'buf' in user memory, the argv/envp strings have a
 * definitive user address for the lifetime of the image. Record the standard
 * mm fields so that procfs (/proc/pid/{cmdline,environ,stat}) sees a spawned
 * process instead of bailing out on mm->env_end == 0 in get_mm_cmdline().
 */
static void set_mm_arg_env_spans(struct wasm_process_args *args, long offset)
{
	struct mm_struct *mm = current->mm;
	char *arg_start, *arg_end, *env_start, *env_end;

	if (!mm || !args->argc)
		return;

	/* argv[]/envp[] hold kernel blob addresses at this point. */
	arg_start = args->argv[0];
	arg_end = args->argv[args->argc - 1];
	arg_end += strnlen(arg_end, MAX_ARG_STRLEN) + 1;

	if (args->envc) {
		env_start = args->envp[0];
		env_end = args->envp[args->envc - 1];
		env_end += strnlen(env_end, MAX_ARG_STRLEN) + 1;
	} else {
		env_start = env_end = arg_end;
	}

	spin_lock(&mm->arg_lock);
	mm->arg_start = (unsigned long)(arg_start + offset);
	mm->arg_end = (unsigned long)(arg_end + offset);
	mm->env_start = (unsigned long)(env_start + offset);
	mm->env_end = (unsigned long)(env_end + offset);
	spin_unlock(&mm->arg_lock);
}

__attribute__((export_name("get_args"))) int get_args(void *buf)
{
	struct wasm_process_args *args = current_thread_info()->args;
	long offset = ((long)buf - (long)args);
	size_t *auxv;
	if (!args)
		return -EINVAL;

	set_mm_arg_env_spans(args, offset);

	for (int i = 0; i < args->argc; i++)
		args->argv[i] += offset;
	for (int i = 0; i < args->envc; i++)
		args->envp[i] += offset;

	/*
	 * Pointer-valued auxv entries index into the blob and must be relocated
	 * like argv/envp. Read the vector via the still-kernel envp base before
	 * it is shifted below.
	 */
	auxv = (size_t *)(args->envp + args->envc + 1);
	for (int i = 0; auxv[i]; i += 2)
		if (auxv[i] == AT_RANDOM)
			auxv[i + 1] += offset;

	args->argv += offset / sizeof(void *);
	args->envp += offset / sizeof(void *);

	if (copy_to_user(buf, args, sizeof(*args) + args->len))
		return -EFAULT;

	kfree(args);
	current_thread_info()->args = NULL;

	return 0;
}

/*
 * Wasm user memory cannot be read from a foreign task context (see the
 * CONFIG_WASM branch in __access_remote_vm()), so tools like ps could never
 * fetch another process's argv out of user memory. The cmdline was already
 * captured into args->cmdline at copy_args() time (while argv[] still pointed
 * at the pristine blob); here we just move that copy into the new mm so
 * /proc/<pid>/cmdline can read it after the blob is gone.
 *
 * Must run after begin_new_exec() so current->mm is the new image's mm.
 * Failure is not fatal: the process just shows an empty cmdline.
 */
static void save_cmdline(void)
{
	struct wasm_process_args *args = current_thread_info()->args;
	struct mm_struct *mm = current->mm;

	if (!args || !mm)
		return;

	mm->context.cmdline = args->cmdline;
	mm->context.cmdline_len = args->cmdline_len;
	args->cmdline = NULL;	/* owned by mm now; get_args() kfree()s args */
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

	save_cmdline();

	wasm_user_instantiate(true);

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
