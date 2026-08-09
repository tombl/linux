/* Target configuration for wasm32-unknown-linux-musl (native, not Emscripten). */

#ifndef LIBFFI_TARGET_H
#define LIBFFI_TARGET_H

#ifndef LIBFFI_H
#error "Please do not include ffitarget.h directly into your source.  Use ffi.h instead."
#endif

#ifndef LIBFFI_ASM
typedef unsigned long ffi_arg;
typedef signed long ffi_sarg;

typedef enum ffi_abi {
  FFI_FIRST_ABI = 0,
  FFI_WASM_LINUX,
  FFI_LAST_ABI,
  FFI_DEFAULT_ABI = FFI_WASM_LINUX
} ffi_abi;
#endif

#define FFI_CLOSURES 1
#define FFI_GO_CLOSURES 0
#define FFI_NATIVE_RAW_API 0
#define FFI_TARGET_SPECIFIC_VARIADIC 1
#define FFI_EXTRA_CIF_FIELDS unsigned int nfixedargs;
#define FFI_TRAMPOLINE_SIZE 16

#endif
