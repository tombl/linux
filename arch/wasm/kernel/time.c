#include <linux/clockchips.h>
#include <linux/clocksource.h>
#include <linux/cpuhotplug.h>
#include <linux/delay.h>
#include <linux/init.h>
#include <linux/interrupt.h>
#include <linux/irq.h>
#include <linux/irqdomain.h>
#include <linux/timekeeping.h>
#include <asm/irq.h>
#include <asm/wasm_imports.h>
#include <asm/param.h>
#include <asm/timex.h>
#include <asm/processor.h>

extern unsigned long loops_per_jiffy;
extern void wasm_set_timer_deadline(u64 deadline_ns);

static int timer_irq;
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

unsigned long long sched_clock(void)
{
	static u64 origin = 0;
	if (!origin)
		origin = wasm_kernel_get_now_nsec();
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

void read_persistent_clock64(struct timespec64 *ts)
{
	*ts = ns_to_timespec64(wasm_kernel_get_now_nsec());
}

static DEFINE_PER_CPU(struct clock_event_device, clockevent);

static irqreturn_t timer_interrupt(int irq, void *dev)
{
	struct clock_event_device *evt = this_cpu_ptr(&clockevent);

	if (evt->event_handler)
		evt->event_handler(evt);

	return IRQ_HANDLED;
}

static int timer_set_next_event(unsigned long delta,
				struct clock_event_device *evt)
{
	u64 now = wasm_kernel_get_now_nsec();
	u64 deadline = now + delta;
	wasm_set_timer_deadline(deadline);
	return 0;
}

static int timer_set_oneshot(struct clock_event_device *evt)
{
	return 0;
}

static int wasm_timer_shutdown(struct clock_event_device *evt)
{
	wasm_set_timer_deadline(0);
	return 0;
}

static int timer_starting_cpu(unsigned int cpu)
{
	struct clock_event_device *evt = this_cpu_ptr(&clockevent);

	evt->name = "wasm-timer";
	evt->features = CLOCK_EVT_FEAT_ONESHOT;
	evt->rating = 300;
	evt->set_next_event = timer_set_next_event;
	evt->set_state_oneshot = timer_set_oneshot;
	evt->set_state_shutdown = wasm_timer_shutdown;
	evt->cpumask = cpumask_of(cpu);
	evt->irq = timer_irq;

	clockevents_config_and_register(evt, NSEC_PER_SEC, 1000, LONG_MAX);

	return 0;
}

void __init time_init(void)
{
	int ret;

	if (clocksource_register_khz(&clocksource, 1000 * 1000))
		panic("unable to register clocksource\n");

	timer_irq = irq_create_mapping(NULL, TIMER_IRQ);
	if (!timer_irq)
		panic("unable to create IRQ mapping for timer\n");

	if (request_irq(timer_irq, timer_interrupt, IRQF_TIMER, "timer", NULL))
		panic("unable to request timer IRQ\n");

	ret = cpuhp_setup_state(CPUHP_AP_ONLINE_DYN, "wasm/timer:online",
				timer_starting_cpu, NULL);
	if (ret < 0)
		panic("unable to setup CPU hotplug state\n");
}
