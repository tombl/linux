LD = wasm-ld

WASM_FEATURES = -matomics -mbulk-memory -mexception-handling -mextended-const -mmultivalue -mmutable-globals -mnontrapping-fptoint -mreference-types -mrelaxed-simd -msign-ext -msimd128 -mtail-call

cflags-y += -Wno-incompatible-library-redeclaration '-D__builtin_return_address=wasm_return_address' $(WASM_FEATURES)
ldflags-y += --import-memory --export-all --stack-first

KBUILD_CFLAGS += $(cflags-y)
KBUILD_AFLAGS += $(aflags-y)
KBUILD_LDFLAGS += $(ldflags-y)
