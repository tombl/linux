#include <linux/init.h>

void calibrate_delay(void)
{
}

void __init time_init(void)
{
	__builtin_trap();
}

void __udelay(unsigned long usecs)
{
	__builtin_trap();
}
void __ndelay(unsigned long nsecs)
{
	__builtin_trap();
}
void __const_udelay(unsigned long xloops)
{
	__builtin_trap();
}
void __delay(unsigned long loops)
{
	__builtin_trap();
}
