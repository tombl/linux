#define __con_initcall_start __xxx_con_initcall_start
#define __con_initcall_end __xxx_con_initcall_end

#include <linux/memblock.h>
#include <linux/of_fdt.h>

#undef __con_initcall_start
#undef __con_initcall_end

char __init_begin[0], __init_end[0];
char __start___ex_table, __stop___ex_table;
char __sched_text_start, __sched_text_end;
char __cpuidle_text_start, __cpuidle_text_end;
char __lock_text_start, __lock_text_end;
char __reservedmem_of_table, __reservedmem_of_table;

#define INITCALL_LEVEL(n) void *__initcall##n##_start, *__initcall##n##_end;

INITCALL_LEVEL(early)
INITCALL_LEVEL(0) INITCALL_LEVEL(0s)
INITCALL_LEVEL(1) INITCALL_LEVEL(1s)
INITCALL_LEVEL(2) INITCALL_LEVEL(2s)
INITCALL_LEVEL(3) INITCALL_LEVEL(3s)
INITCALL_LEVEL(4) INITCALL_LEVEL(4s)
INITCALL_LEVEL(5) INITCALL_LEVEL(5s)
INITCALL_LEVEL(rootfs)
INITCALL_LEVEL(6) INITCALL_LEVEL(6s)
INITCALL_LEVEL(7) INITCALL_LEVEL(7s)

#undef INITCALL_LEVEL

void *__con_initcall_start, *__con_initcall_end;
void *__start___param, *__stop___param;
void *__per_cpu_load, *__per_cpu_start, *__per_cpu_end;
void *__setup_start, *__setup_end;

struct section_mapping {
	void *start, *end, *mapped;
};
struct section_mapping percpu_sections[5];

void init_sections(unsigned long node)
{
	const __be32 *prop;
	u64 base, _;
	int len;
	void *here;
	void *percpu_first_start, *percpu_first_end;
	void *percpu_page_aligned_start, *percpu_page_aligned_end;
	void *percpu_read_mostly_start, *percpu_read_mostly_end;
	void *percpu_start, *percpu_end;
	void *percpu_shared_aligned_start, *percpu_shared_aligned_end;
	size_t percpu_first_size, percpu_page_aligned_size,
		percpu_read_mostly_size, percpu_size,
		percpu_shared_aligned_size, total_size;

#define SECTION(sec, start, size, end)                      \
	prop = of_get_flat_dt_prop(node, sec, &len);        \
	base = dt_mem_next_cell(dt_root_addr_cells, &prop); \
	size = dt_mem_next_cell(dt_root_size_cells, &prop); \
	start = (void *)base;                               \
	end = (void *)(base + size);

	// keep in sync with %keep in arch/wasm/scripts/sections.pl

	#define INITCALL_LEVEL(n) SECTION(".initcall" #n ".init", __initcall##n##_start, _, __initcall##n##_end); 

	INITCALL_LEVEL(early)
	INITCALL_LEVEL(0) INITCALL_LEVEL(0s)
	INITCALL_LEVEL(1) INITCALL_LEVEL(1s)
	INITCALL_LEVEL(2) INITCALL_LEVEL(2s)
	INITCALL_LEVEL(3) INITCALL_LEVEL(3s)
	INITCALL_LEVEL(4) INITCALL_LEVEL(4s)
	INITCALL_LEVEL(5) INITCALL_LEVEL(5s)
	INITCALL_LEVEL(rootfs)
	INITCALL_LEVEL(6) INITCALL_LEVEL(6s)
	INITCALL_LEVEL(7) INITCALL_LEVEL(7s)

	#undef INITCALL_LEVEL

	SECTION("__param",		__start___param,	_,	__stop___param);
	SECTION(".con_initcall.init",	__con_initcall_start,	_,	__con_initcall_start);
	SECTION(".init.setup",		__setup_start,		_,	__setup_end);

	SECTION(".data..percpu..first",			percpu_first_start,		percpu_first_size, 		percpu_first_end);
	SECTION(".data..percpu..page_aligned",		percpu_page_aligned_start,	percpu_page_aligned_size, 	percpu_page_aligned_end);
	SECTION(".data..percpu..read_mostly",		percpu_read_mostly_start,	percpu_read_mostly_size, 	percpu_read_mostly_end);
	SECTION(".data..percpu",			percpu_start,			percpu_size,			percpu_end);
	SECTION(".data..percpu..shared_aligned",	percpu_shared_aligned_start,	percpu_shared_aligned_size,	percpu_shared_aligned_end);

	percpu_first_size = ALIGN(percpu_first_size, PAGE_SIZE);
	percpu_page_aligned_size = ALIGN(percpu_page_aligned_size, L1_CACHE_BYTES);
	percpu_read_mostly_size = ALIGN(percpu_read_mostly_size, L1_CACHE_BYTES);

	total_size = percpu_first_size + percpu_page_aligned_size +
		     percpu_read_mostly_size + percpu_size +
		     percpu_shared_aligned_size;

	__per_cpu_start = memblock_alloc(total_size, PAGE_SIZE);
	__per_cpu_load = __per_cpu_start;
	__per_cpu_end = __per_cpu_start + total_size;

	here = __per_cpu_start;

	memcpy(here, percpu_first_start, percpu_first_size);
	percpu_sections[0].start = percpu_first_start;
	percpu_sections[0].end = percpu_first_end;
	percpu_sections[0].mapped = here;
	here += percpu_first_size;

	memcpy(here, percpu_page_aligned_start, percpu_page_aligned_size);
	percpu_sections[1].start = percpu_page_aligned_start;
	percpu_sections[1].end = percpu_page_aligned_end;
	percpu_sections[1].mapped = here;
	here += percpu_page_aligned_size;

	memcpy(here, percpu_read_mostly_start, percpu_read_mostly_size);
	percpu_sections[2].start = percpu_read_mostly_start;
	percpu_sections[2].end = percpu_read_mostly_end;
	percpu_sections[2].mapped = here;
	here += percpu_read_mostly_size;

	memcpy(here, percpu_start, percpu_size);
	percpu_sections[3].start = percpu_start;
	percpu_sections[3].end = percpu_end;
	percpu_sections[3].mapped = here;
	here += percpu_size;

	memcpy(here, percpu_shared_aligned_start, percpu_shared_aligned_size);
	percpu_sections[4].start = percpu_shared_aligned_start;
	percpu_sections[4].end = percpu_shared_aligned_end;
	percpu_sections[4].mapped = here;
}