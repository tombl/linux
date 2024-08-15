#include <linux/clocksource.h>
#include <linux/delay.h>
#include <linux/init.h>
#include <asm/wasm_imports.h>
#include <asm/param.h>
#include <asm/timex.h>
#include <asm/processor.h>

extern unsigned long loops_per_jiffy;
void calibrate_delay(void)
{
	loops_per_jiffy = 1000000000 / HZ;
}

void __delay(unsigned long cycles)
{
	static int zero = 0;
	int ret = __builtin_wasm_memory_atomic_wait32(&zero, 0, cycles);
	BUG_ON(ret != 2); // 2 means timeout
}

void __udelay(unsigned long usecs)
{
	__delay(usecs * 1000);
}
void __ndelay(unsigned long nsecs)
{
	__delay(nsecs);
}
void __const_udelay(unsigned long xloops)
{
	__delay(xloops / 0x10c7ul); /* 2**32 / 1000000 (rounded up) */
}

unsigned long long sched_clock(void) {
	static u64 origin = 0;
	if (!origin) origin = wasm_kernel_get_now_nsec();
	return wasm_kernel_get_now_nsec() - origin;
}

static u64 clock_read(struct clocksource *cs)
{
	return sched_clock();
}

static struct clocksource clocksource = {
	.name = "wasm",
	.rating = 499,
	.read = clock_read,
	.flags = CLOCK_SOURCE_IS_CONTINUOUS,
	.mask = CLOCKSOURCE_MASK(64),
};

void __init time_init(void)
{
	if (clocksource_register_khz(&clocksource, 1000 * 1000))
		panic("unable to register clocksource\n");
}
