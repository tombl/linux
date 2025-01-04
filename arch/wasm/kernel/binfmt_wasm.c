#define pr_fmt(fmt) KBUILD_MODNAME ": " fmt

#include <linux/binfmts.h>
#include <linux/mman.h>
#include <linux/personality.h>
#include <linux/ptrace.h>

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
