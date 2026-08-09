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

- no GTK3 / cairo / pango stack in wasmpkgs
- Gecko multiprocess assumes `fork` (platform has posix_spawn only)
- jemalloc / sandbox paths want `mmap`
- need the distro `rust-toolchain` wired into mozbuild for this triple

Next concrete steps:

1. Pin the ESR `src` hash and clear `meta.broken` for the JS shell attempt
2. Package GTK prerequisites only if the JS shell configures cleanly
3. Keep NetSurf libs (`tools/wasm/userspace/netsurf`) as an alternate engine path

## Links / NetSurf

- **Links**: package exists; clang 22 ICEs on `charsets.c` / `bfu.c` for this
  target (`meta.broken`).
- **NetSurf**: leaf libs packaged; X surface needs `xcb-util-*` (not yet).
