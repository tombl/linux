#define pr_fmt(fmt) KBUILD_MODNAME ": " fmt

#include <linux/binfmts.h>
#include <linux/highmem.h>
#include <linux/mman.h>
#include <linux/personality.h>
#include <linux/ptrace.h>
#include <linux/syscalls.h>

static int load_wasm_binary(struct linux_binprm *bprm);

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
	struct wasm_process_args *args;
	int stop = bprm->p >> PAGE_SHIFT;
	int len = ((bprm->argc + bprm->envc + 2) * sizeof(char *)) +
		  (PAGE_SIZE * (MAX_ARG_PAGES - stop)) + (bprm->p & ~PAGE_MASK);
	char *data;
	int ret;

	args = kmalloc(sizeof(*args) + len, GFP_KERNEL);
	if (!args)
		return -ENOMEM;

	args->argc = bprm->argc;
	args->envc = bprm->envc;
	args->len = len;

	data = args->data + len;
	for (int index = MAX_ARG_PAGES - 1; index >= stop; index--) {
		unsigned int offset = index == stop ? bprm->p & ~PAGE_MASK : 0;
		char *src = kmap_local_page(bprm->page[index]) + offset;
		data -= PAGE_SIZE - offset;
		memcpy(data, src, PAGE_SIZE - offset);
		kunmap_local(src);
	}

	args->argv = (char **)(args->data);
	for (int i = bprm->argc; i > 0; i--) {
		len = strnlen(data, MAX_ARG_STRLEN);
		if (!len || len > MAX_ARG_STRLEN) {
			ret = -EINVAL;
			goto err;
		}
		args->argv[i - 1] = data;
		data += len + 1;
	}
	args->argv[bprm->argc] = NULL;

	args->envp = args->argv + bprm->argc + 1;
	for (int i = bprm->envc; i > 0; i--) {
		len = strnlen(data, MAX_ARG_STRLEN);
		if (!len || len > MAX_ARG_STRLEN) {
			ret = -EINVAL;
			goto err;
		}
		args->envp[i - 1] = data;
		data += len + 1;
	}
	args->envp[bprm->envc] = NULL;

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

__attribute__((export_name("get_args"))) int get_args(void *buf)
{
	struct wasm_process_args *args = current_thread_info()->args;
	long offset = ((long)buf - (long)args);
	if (!args)
		return -EINVAL;

	__builtin_dump_struct(args, _printk);

	for (int i = 0; i < args->argc; i++)
		args->argv[i] += offset;
	for (int i = 0; i < args->envc; i++)
		args->envp[i] += offset;

	args->argv += offset / sizeof(void *);
	args->envp += offset / sizeof(void *);

	if (copy_to_user(buf, args, sizeof(*args) + args->len))
		return -EFAULT;

	kfree(args);
	current_thread_info()->args = NULL;

	return 0;
}

static int load_wasm_binary(struct linux_binprm *bprm)
{
	int ret;
	u8 *code = NULL;
	loff_t filesize;

	if (strncmp(bprm->buf, "\0asm\1\0\0\0", 8))
		return -ENOEXEC;

	ret = file_get_size(bprm->file, &filesize);
	if (ret < 0)
		return ret;

	code = (char *)vm_mmap(bprm->file, 0, filesize, PROT_READ | PROT_WRITE,
			       MAP_PRIVATE, 0);
	if (IS_ERR(code)) {
		ret = PTR_ERR(code);
		goto err;
	}

	ret = wasm_user_compile(code, filesize);
	if (ret)
		goto err;

	ret = vm_munmap((uintptr_t)code, filesize);
	code = NULL;
	if (ret)
		goto err;

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

	wasm_user_instantiate();

	return 0;
err:
	if (!IS_ERR_OR_NULL(code))
		vm_munmap((uintptr_t)code, filesize);
	return ret;
}

static int __init init_wasm_binfmt(void)
{
	register_binfmt(&wasm_format);
	return 0;
}
core_initcall(init_wasm_binfmt);
