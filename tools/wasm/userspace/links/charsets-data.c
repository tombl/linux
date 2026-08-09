/* charsets-data.c — charset lookup tables split out of charsets.c so clang 22
 * wasm codegen does not ICE on the combined translation unit.
 */
#include <stddef.h>

#include "charsets-data.h"
#include "os_depx.h"

#undef static_const
#define static_const

#include "codepage.inc"
#include "uni_7b.inc"
#include "entity.inc"
#include "upcase.inc"
#include "locase.inc"
