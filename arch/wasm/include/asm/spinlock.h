#include <asm/qspinlock.h>
#include <asm/qrwlock.h>
#define smp_mb__after_spinlock() smp_mb()
