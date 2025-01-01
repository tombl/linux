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

static u8 *read_uleb128(u8 *buf, int max_len, u64 *result)
{
	int shift = 0;
	u8 byte;
	*result = 0;
	do {
		byte = *buf;
		buf += 1;
		*result |= (byte & 0x7f) << shift;
		shift += 7;
	} while (max_len-- > 0 && byte & 0x80);
	return buf;
}
static u8 *read_u32(u8 *buf, u32 *result)
{
	u64 val;
	buf = read_uleb128(buf, 5, &val);
	*result = val;
	return buf;
}

struct wasm_section {
	u8 id;
	u32 size;
	u8 *data;
};
static u8 *read_wasm_section(u8 *buf, struct wasm_section *section)
{
	section->id = *buf++;
	buf = read_u32(buf, &section->size);
	section->data = buf;
	buf += section->size;
	return buf;
}

#define for_each_wasm(thing)                                      \
	for (here = read_wasm_##thing(here, &thing); here <= end; \
	     here = read_wasm_##thing(here, &thing))

struct wasm_string {
	u32 len;
	u8 *data;
};
static u8 *read_wasm_string(u8 *buf, struct wasm_string *name)
{
	buf = read_u32(buf, &name->len);
	name->data = buf;
	buf += name->len;
	return buf;
}

enum wasm_section_id {
	WASM_CUSTOM_SECTION = 0,
};

enum wasm_dylink_section_id {
	WASM_DYLINK_MEM_INFO = 1,
	WASM_DYLINK_NEEDED = 2,
	WASM_DYLINK_EXPORT_INFO = 3,
	WASM_DYLINK_IMPORT_INFO = 4,
};

struct wasm_dylink_mem_info {
	u32 mem_size;
	u32 mem_align_pow2;
	u32 table_size;
	u32 table_align_pow2;
};
static u8 *read_wasm_dylink_mem_info(u8 *buf,
				     struct wasm_dylink_mem_info *mem_info)
{
	buf = read_u32(buf, &mem_info->mem_size);
	buf = read_u32(buf, &mem_info->mem_align_pow2);
	buf = read_u32(buf, &mem_info->table_size);
	buf = read_u32(buf, &mem_info->table_align_pow2);
	return buf;
}

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

static int get_wasm_dylink_mem_info(u8 *code, loff_t size,
				    struct wasm_dylink_mem_info *info)
{
	u8 *here = code + 8; // skip magic
	u8 *end = code + size;
	int ret = 0;

	struct wasm_section section;
	for_each_wasm(section)
	{
		u8 *here = section.data, *end = here + section.size;
		struct wasm_string name;

		if (section.id != WASM_CUSTOM_SECTION)
			continue;

		here = read_wasm_string(here, &name);
		if (name.len != 8 || strncmp(name.data, "dylink.0", 8))
			continue;
		if (here > end) {
			pr_info("dylink section too short\n");
			ret = -ENOEXEC;
			goto err;
		}

		for_each_wasm(section)
		{
			u8 *here = section.data, *end = here + section.size;
			switch (section.id) {
			case WASM_DYLINK_MEM_INFO: {
				here = read_wasm_dylink_mem_info(section.data,
								 info);
				if (here > end) {
					pr_info("dylink mem_info section too short\n");
					ret = -ENOEXEC;
					goto err;
				}
				break;
			}
			case WASM_DYLINK_NEEDED:
			case WASM_DYLINK_IMPORT_INFO:
				// TODO: implement via userspace dynamic loader
				pr_warn("dynamic linking not supported yet\n");
				break;
			case WASM_DYLINK_EXPORT_INFO:
				// do nothing
				break;
			default:
				pr_warn("unknown dylink section: %d\n",
					section.id);
				break;
			}
		}
	}

	return 0;
err:
	return ret;
}

int wasm_import(user, compile)(u8 *bytes, u32 len);
void wasm_import(user, instantiate)(u32 stack, u32 memory, u32 table_size);

static int load_wasm_binary(struct linux_binprm *bprm)
{
	int ret;
	u8 *code = NULL;
	loff_t filesize;
	struct wasm_dylink_mem_info mem_info = { 0 };
	struct {
		unsigned long base, stack_size, memory_with_brk, total_size;
	} mem_layout;

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

	ret = get_wasm_dylink_mem_info(code, filesize, &mem_info);
	if (ret)
		goto err;

	if (mem_info.mem_size > rlimit(RLIMIT_DATA)) {
		ret = -ENOMEM;
		goto err;
	}

	mem_layout.stack_size = rlimit(RLIMIT_STACK);
	mem_layout.memory_with_brk =
		round_up(mem_info.mem_size, PAGE_SIZE) + PAGE_SIZE;
	mem_layout.total_size =
		mem_layout.memory_with_brk + PAGE_SIZE + mem_layout.stack_size;

	mem_layout.base = vm_mmap(0, 0, mem_layout.total_size,
				  PROT_READ | PROT_WRITE,
				  MAP_PRIVATE | MAP_ANONYMOUS, 0);
	if (IS_ERR_VALUE(mem_layout.base)) {
		ret = mem_layout.base;
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

	current->mm->start_data = mem_layout.base;
	current->mm->end_data = mem_layout.base + mem_info.mem_size;

	current->mm->start_brk = mem_layout.base + mem_info.mem_size;
	current->mm->context.end_brk = mem_layout.base +
				       round_up(mem_info.mem_size, PAGE_SIZE) +
				       PAGE_SIZE;

	current->mm->start_stack = mem_layout.base + mem_layout.total_size;

	finalize_exec(bprm);

	wasm_user_instantiate(current->mm->start_stack, current->mm->start_data,
			      mem_info.table_size);

	return 0;
err:
	if (!IS_ERR_OR_NULL(code))
		vm_munmap((uintptr_t)code, filesize);
	if (!IS_ERR_OR_NULL((void *)mem_layout.base))
		vm_munmap(mem_layout.base, mem_layout.total_size);
	return ret;
}

static int __init init_wasm_binfmt(void)
{
	register_binfmt(&wasm_format);
	return 0;
}
core_initcall(init_wasm_binfmt);
