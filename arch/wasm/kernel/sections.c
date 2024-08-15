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
void *__start_once, *__end_once;

struct section {
	void *start, *end;
	u64 size;
};

struct section_mapping {
	void *start, *end, *mapped;
};

static struct section_mapping percpu_sections[5];

void* __percpu_section_remap(void *addr) {
	for (int i = 0; i < ARRAY_SIZE(percpu_sections); i++) {
		struct section_mapping *map = &percpu_sections[i];
		if (map->start <= addr && addr < map->end){
			return map->mapped + (addr - map->start);}
	}

	return addr;
}

void __init init_sections(unsigned long node)
{
	const __be32 *prop;
	u64 base, _, percpu_total_size;
	int len;
	void *here;
	struct section percpu_first, percpu_page_aligned, percpu_read_mostly,
		percpu, percpu_shared_aligned;

#define SECTION(name, start, size, end)                             \
	prop = of_get_flat_dt_prop(node, name, &len);               \
	if (prop) {                                                 \
		base = dt_mem_next_cell(dt_root_addr_cells, &prop); \
		size = dt_mem_next_cell(dt_root_size_cells, &prop); \
		start = (void *)base;                               \
		end = (void *)(base + size);                        \
	} else {                                                    \
		start = 0;                                          \
		size = 0;                                           \
		end = 0;                                            \
	}

#define SECTION_STRUCT(name, section) SECTION(name, section.start, section.size, section.end)

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
	SECTION(".data.once",		__start_once,		_,	__end_once);

	SECTION_STRUCT(".data..percpu..first",		percpu_first);
	SECTION_STRUCT(".data..percpu..page_aligned",	percpu_page_aligned);
	SECTION_STRUCT(".data..percpu..read_mostly",	percpu_read_mostly);
	SECTION_STRUCT(".data..percpu",			percpu);
	SECTION_STRUCT(".data..percpu..shared_aligned",	percpu_shared_aligned);

	percpu_first.size = ALIGN(percpu_first.size, PAGE_SIZE);
	percpu_page_aligned.size = ALIGN(percpu_page_aligned.size, L1_CACHE_BYTES);
	percpu_read_mostly.size = ALIGN(percpu_read_mostly.size, L1_CACHE_BYTES);

	percpu_total_size = percpu_first.size + percpu_page_aligned.size +
		     percpu_read_mostly.size + percpu.size +
		     percpu_shared_aligned.size;

	__per_cpu_start = memblock_alloc(percpu_total_size, PAGE_SIZE);
	__per_cpu_load = __per_cpu_start;
	__per_cpu_end = __per_cpu_start + percpu_total_size;

	here = __per_cpu_start;

	memcpy(here, percpu_first.start, percpu_first.size);
	percpu_sections[0].start = percpu_first.start;
	percpu_sections[0].end = percpu_first.end;
	percpu_sections[0].mapped = here;
	here += percpu_first.size;

	memcpy(here, percpu_page_aligned.start, percpu_page_aligned.size);
	percpu_sections[1].start = percpu_page_aligned.start;
	percpu_sections[1].end = percpu_page_aligned.end;
	percpu_sections[1].mapped = here;
	here += percpu_page_aligned.size;

	memcpy(here, percpu_read_mostly.start, percpu_read_mostly.size);
	percpu_sections[2].start = percpu_read_mostly.start;
	percpu_sections[2].end = percpu_read_mostly.end;
	percpu_sections[2].mapped = here;
	here += percpu_read_mostly.size;

	memcpy(here, percpu.start, percpu.size);
	percpu_sections[3].start = percpu.start;
	percpu_sections[3].end = percpu.end;
	percpu_sections[3].mapped = here;
	here += percpu.size;

	memcpy(here, percpu_shared_aligned.start, percpu_shared_aligned.size);
	percpu_sections[4].start = percpu_shared_aligned.start;
	percpu_sections[4].end = percpu_shared_aligned.end;
	percpu_sections[4].mapped = here;
}
