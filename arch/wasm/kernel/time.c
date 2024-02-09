#include "linux/delay.h"
#include <linux/init.h>
#include <asm/param.h>
#include <asm/timex.h>
#include <asm/processor.h>

extern unsigned long loops_per_jiffy;
void calibrate_delay(void)
{
	loops_per_jiffy = 1000000000 / HZ;
}

void __init time_init(void)
{
}

void __delay(unsigned long cycles)
{
	cycles_t start = get_cycles();

	while ((get_cycles() - start) < cycles)
		cpu_relax();
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
	unsigned long long loops;

	loops = (unsigned long long)xloops * loops_per_jiffy * HZ;

	__delay(loops >> 32);
}
