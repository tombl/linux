watchkernel:
    watchexec -r -f '**/*.c' -f '**/*.h' -f '**/Makefile*' just kernel '&&' notify-send -e kernel
watchjs:
    watchexec -w tools/wasm/src just js

watchrun:
    watchexec -r -w tools/wasm/vmlinux.wasm -w tools/wasm/src --ignore-nothing just run
watchrunnode:
    watchexec -r -w tools/wasm/vmlinux.wasm -w tools/wasm/dist --ignore-nothing just runnode

kernel:
    make -j16 tools/wasm/vmlinux.wasm
js:
    make tools/wasm

run:
    tools/wasm/run.ts
runnode:
    tools/wasm/index.js

serve:
    miniserve tools/wasm/ --index index.html \
        --header Cross-Origin-Opener-Policy:same-origin \
        --header Cross-Origin-Embedder-Policy:require-corp \
        --header Cross-Origin-Resource-Policy:cross-origin
