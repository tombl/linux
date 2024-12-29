#define pr_fmt(fmt) KBUILD_MODNAME ": " fmt
#include <linux/ptrace.h>
#include <linux/binfmts.h>

static int load_wasm_binary(struct linux_binprm *bprm);

static struct linux_binfmt wasm_format = {
	.module = THIS_MODULE,
	.load_binary = load_wasm_binary,
};

static int load_wasm_binary(struct linux_binprm *bprm)
{
        if (strncmp(bprm->buf, "\0asm", 4)) {
                return -ENOEXEC;
        }

	set_binfmt(&wasm_format);
	finalize_exec(bprm);

        // TODO: read file, instantiate module, call with args

        BUG();

	return 0;
}

static int __init init_wasm_binfmt(void)
{
	register_binfmt(&wasm_format);
	return 0;
}
core_initcall(init_wasm_binfmt);
