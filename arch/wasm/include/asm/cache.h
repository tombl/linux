#ifndef _WASM_CACHE_H
#define _WASM_CACHE_H

/* We have no way of knowing what the real cache line size is,
 * so let's assume it's 64 bytes.
 */

#define L1_CACHE_SHIFT (6)
#define L1_CACHE_BYTES (1 << L1_CACHE_SHIFT)

#endif