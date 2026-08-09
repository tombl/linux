# Guest browser status (wasm32-unknown-linux-musl)

## Networking (done)

Guest traffic path:

```
wget/curl → Linux TCP/IP → virtio-net → createNetwork gateway (192.0.2.1)
  → WebSocket `/tcp` + `/dns` → Cloudflare Worker (`cloudflare:sockets`)
     or local demo server (`tools/wasm/demo/server.mjs`)
```

Verified headless smoke:

```
network: wget google.com ok (82524 bytes)
```

Demo wires this automatically (`tools/wasm/demo/main.js`). Override the proxy with
`?proxy=wss://your-worker.workers.dev`. Deploy the Worker from
`tools/wasm/network/cf-tcp-proxy`.

## Firefox / Gecko

Package: `tools/wasm/userspace/firefox/package.nix` (Firefox **128.14.0esr**,
`--enable-project=js` SpiderMonkey shell first).

Still blocked for a full browser:

- Gecko multiprocess assumes `fork` (platform has posix_spawn only)
- jemalloc / sandbox paths want `mmap`
- need the distro `rust-toolchain` wired into mozbuild for this triple

### GTK stack packaging (wasm32-unknown-linux-musl)

Built static libraries:

| Package | Out-link |
|---------|----------|
| expat | `/tmp/result-expat` → `…-expat-static-wasm32-unknown-linux-musl-2.8.2` |
| freetype | `/tmp/result-freetype` → `…-freetype-static-wasm32-unknown-linux-musl-2.14.3` |
| fontconfig | `/tmp/result-fontconfig` → `…-fontconfig-static-wasm32-unknown-linux-musl-2.18.1` |
| fribidi | `/tmp/result-fribidi` → `…-fribidi-static-wasm32-unknown-linux-musl-1.0.16` |
| harfbuzz | `/tmp/result-harfbuzz` → `…-harfbuzz-static-wasm32-unknown-linux-musl-13.2.1` |
| pixman | `/tmp/result-pixman` → `…-pixman-static-wasm32-unknown-linux-musl-0.46.4` |
| pcre2 | `/tmp/result-pcre2` → `…-pcre2-static-wasm32-unknown-linux-musl-10.46` |
| **cairo** | `/tmp/result-cairo` → `…-cairo-static-wasm32-unknown-linux-musl-1.18.4` |
| **libffi** | `/tmp/result-libffi` → `…-libffi-static-wasm32-unknown-linux-musl-3.4.8` |

Failed / blocked:

| Package | Reason |
|---------|--------|
| glib, pango, gdk-pixbuf, atk, gtk3 | depend on libffi (GObject closures); libffi builds, GTK stack not packaged yet |
| links | clang 22 ICE on `charsets-encode.c` after data-table split; `bfu.c` needs `-O0` |

Build example: `cd /tmp/distro && nix build --impure --accept-flake-config --expr 'let flake=builtins.getFlake "path:/tmp/distro"; pkgs=import flake.inputs.nixpkgs {system="x86_64-linux";}; wasmpkgs=flake.legacyPackages.x86_64-linux; gui=import /workspace/tools/wasm/userspace {inherit pkgs wasmpkgs;}; in gui.PACKAGE' -L --out-link /tmp/result-PACKAGE`

## Links

Package: `tools/wasm/userspace/links/package.nix` (text mode, `--disable-graphics`).

Progress:

- `charsets-data.c` + `charsets-tables.c` build (lookup tables split out of `charsets.c`)
- `bfu.c` compiles with per-file `-O0`
- `charsets-encode.c` (cp2u/encode_utf_8/translation tables) still hits clang 22 codegen ICE

Still `meta.broken` until encode/entity/extra TUs compile and link.

## libffi

Built with a wasm-linux backend (`src/wasm-linux/`) instead of upstream's Emscripten-only
`wasm32/ffi.c`. Patches:

- `wasm-no-mmap-closures.patch` — skip `FFI_MMAP_EXEC_WRIT` on `__wasm__`; skip generic
  `closures.c` (port provides `ffi_closure_alloc` via malloc).
- `wasm-linux-port.patch` — route `wasm32-*-linux*` to `wasm-linux` in `configure.host`.

`ffi_call` covers GObject's `g_cclosure_marshal_generic` (arity ≤ 8, integer/pointer/float
args). Indirect closure trampolines via `__indirect_function_table` are still stubbed; GObject's
plain `GCClosure` path uses `ffi_call` against C callbacks and does not need executable closure
pages.
