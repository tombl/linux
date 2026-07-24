// SPDX-License-Identifier: GPL-2.0-only
#include <linux/compiler_types.h>
#include <linux/kernel.h>
#include <linux/types.h>

typedef int ti_type __attribute__((mode(TI)));

union ti_words {
	ti_type value;
	u32 word[4];
};

ti_type __multi3(ti_type a, ti_type b);

/*
 * Clang lowers 128-bit multiplication to this compiler runtime helper on
 * wasm32.  Multiply a word at a time so the implementation itself only needs
 * wasm's native 32- and 64-bit integer operations.
 */
ti_type notrace __multi3(ti_type a, ti_type b)
{
	union ti_words aa = { .value = a };
	union ti_words bb = { .value = b };
	union ti_words result = {};
	u64 carry, product;
	int i, j;

	for (i = 0; i < ARRAY_SIZE(result.word); i++) {
		carry = 0;
		for (j = 0; i + j < ARRAY_SIZE(result.word); j++) {
			product = (u64)aa.word[i] * bb.word[j] +
				  result.word[i + j] + carry;
			result.word[i + j] = product;
			carry = product >> 32;
		}
	}

	return result.value;
}
