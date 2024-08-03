j := `nproc`

watchkernel:
    watchexec -r -f '**/*.c' -f '**/*.h' -f '**/Makefile*' just kernel
watchjs:
    watchexec -w tools/wasm/src just js

watchrun:
    watchexec -r -w tools/wasm/vmlinux.wasm -w tools/wasm/src --ignore-nothing just run
watchrunnode:
    watchexec -r -w tools/wasm/vmlinux.wasm -w tools/wasm/dist --ignore-nothing just runnode
watchrunrust:
    watchexec -r -w vmlinux --ignore-nothing just runrust

kernel:
    make -j{{j}} tools/wasm/vmlinux.wasm tools/wasm/sections.json
js:
    make tools/wasm

run:
    tools/wasm/run.ts
runnode:
    tools/wasm/index.js
runrust:
    cd tools/wasm-runner && cargo build --quiet --release
    ./tools/wasm-runner/target/release/linux_wasm_runner vmlinux tools/wasm/sections.json

debug:
    cd tools/wasm-runner && cargo build --quiet
    rust-lldb \
        -o 'breakpoint set --file setup.c --name _start' \
        -o 'breakpoint set --name wasm_get_dt --command "p __vmctx->set()"' \
        -o 'process launch' \
        -- \
        ./tools/wasm-runner/target/debug/linux_wasm_runner vmlinux --debug

serve:
    miniserve tools/wasm/ --index index.html \
        --header Cross-Origin-Opener-Policy:same-origin \
        --header Cross-Origin-Embedder-Policy:require-corp \
        --header Cross-Origin-Resource-Policy:cross-origin
