j := `nproc`

build:
    make -j{{j}} -C tools/wasm

watch:
    watchexec -r -f '**/*.c' -f '**/*.h' -f '**/Makefile*' -f '**/*.ts' just build

run:
    tools/wasm/run.js -j4
watchrun:
    watchexec -r -w tools/wasm/dist --ignore-nothing just run

runrust:
    cd tools/wasm-runner && cargo build --quiet --release
    ./tools/wasm-runner/target/release/linux_wasm_runner tools/wasm/vmlinux.wasm tools/wasm/sections.json
watchrunrust:
    watchexec -r -w arch/wasm/vmlinux.wasm --ignore-nothing just runrust

debug:
    cd tools/wasm-runner && cargo build --quiet
    rust-lldb \
        -o 'breakpoint set --file setup.c --name _start' \
        -o 'breakpoint set --name wasm_get_dt --command "p __vmctx->set()"' \
        -o 'process launch' \
        -- \
        ./tools/wasm-runner/target/debug/linux_wasm_runner arch/wasm/vmlinux.wasm arch/wasm/sections.json --debug

serve:
    miniserve tools/wasm/public --index index.html \
        --header Cross-Origin-Opener-Policy:same-origin \
        --header Cross-Origin-Embedder-Policy:require-corp \
        --header Cross-Origin-Resource-Policy:cross-origin
