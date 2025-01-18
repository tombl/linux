j := `nproc`
cmdline := ""

build:
    just make -C tools/wasm

watch:
    watchexec -r -f '**/*.c' -f '**/*.h' -f '**/Makefile*' -f 'tools/wasm/src/**/*.ts' just build

run:
    tools/wasm/run.js -j4 -c '{{cmdline}}'
watchrun:
    watchexec -r -w tools/wasm/dist --ignore-nothing --debounce=200ms just run

serve:
    miniserve tools/wasm/public --index index.html \
        --header Cross-Origin-Opener-Policy:same-origin \
        --header Cross-Origin-Embedder-Policy:require-corp \
        --header Cross-Origin-Resource-Policy:cross-origin

make *args:
    make HOSTCC=$HOSTCC -j{{j}} {{args}}
