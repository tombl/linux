#include <asm/page.h>
#include <linux/kbuild.h>

int main(void)
{
	COMMENT("This is a comment from arch/wasm/include/asm/asm-offsets.h");
	DEFINE(_PAGE_SIZE, PAGE_SIZE);
	DEFINE(_PAGE_SHIFT, PAGE_SHIFT);
	BLANK();
}