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

- GTK stack partially packaged (see below); cairo XRender header clash remains
- libffi blocked (mmap in closure trampolines) — blocks GLib/GObject and above
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

Failed / blocked:

| Package | Reason |
|---------|--------|
| libffi | `closures.c` requires `mmap` for executable trampolines |
| cairo | `cairo-xlib-xrender-private.h` typedef clash with xorgproto Render 0.11 |
| glib, pango, gdk-pixbuf, atk, gtk3 | depend on libffi (GObject closures) |

Build example: `cd /tmp/distro && nix build --impure --accept-flake-config --expr 'let flake=builtins.getFlake "path:/tmp/distro"; pkgs=import flake.inputs.nixpkgs {system="x86_64-linux";}; wasmpkgs=flake.legacyPackages.x86_64-linux; gui=import /workspace/tools/wasm/userspace {inherit pkgs wasmpkgs;}; in gui.PACKAGE' -L --out-link /tmp/result-PACKAGE`

Next concrete steps:

1. Pin the ESR `src` hash and clear `meta.broken` for the JS shell attempt
2. Package GTK prerequisites only if the JS shell configures cleanly
3. Keep NetSurf libs (`tools/wasm/userspace/netsurf`) as an alternate engine path

## Links / NetSurf

- **Links**: package exists; clang 22 ICEs on `charsets.c` / `bfu.c` for this
  target (`meta.broken`).
- **NetSurf**: leaf libs packaged; X surface needs `xcb-util-*` (not yet).
