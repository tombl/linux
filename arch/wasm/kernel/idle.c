#include <asm/smp.h>
#include <asm/delay.h>
#include <linux/printk.h>
#include <linux/cpu.h>

// void arch_cpu_idle(void) {
//         pr_info("arch_cpu_idle %d\n", raw_smp_processor_id());
//         __udelay(1000*1000*1000);
// }