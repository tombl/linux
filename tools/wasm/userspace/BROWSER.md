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
| **cairo** | `/tmp/result-cairo` → `…-cairo-static-wasm32-unknown-linux-musl-1.18.4` (incl. cairo-gobject) |
| **libffi** | `/tmp/result-libffi` → `…-libffi-static-wasm32-unknown-linux-musl-3.4.8` |
| **glib** | `/tmp/result-glib` → `…-glib-static-wasm32-unknown-linux-musl-2.82.1` |
| **gdk-pixbuf** | `/tmp/result-gdk-pixbuf` → `…-gdk-pixbuf-static-wasm32-unknown-linux-musl-2.42.12` |
| **pango** | `/tmp/result-pango` → `…-pango-static-wasm32-unknown-linux-musl-1.54.0` |
| **libepoxy** | `/tmp/result-libepoxy` → `…-libepoxy-static-wasm32-unknown-linux-musl-1.5.10` |
| **atk** | `/tmp/result-atk` → `…-atk-static-wasm32-unknown-linux-musl-2.38.0` |
| **gtk+3** | `/tmp/result-gtk3` → `…-gtk+3-static-wasm32-unknown-linux-musl-3.24.52` |

Failed / blocked:

| Package | Reason |
|---------|--------|
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

## glib

Built with meson (static, tests off). Patches:

- `wasm-no-fork.patch` — route `g_spawn*` through `posix_spawn` (working_directory via
  `addchdir_np`, close_descriptors); fail-closed on `fork()` and `child_setup`.
- `wasm-no-fork-backtrace.patch` / `wasm-no-fork-gtestutils.patch` / `wasm-no-fork-gtestdbus.patch` —
  skip remaining `fork()` call sites in library code.
- `wasm-no-mmap-gmappedfile.patch` — `GMappedFile` uses `pread`+malloc on `__wasm__`.

`postConfigure` strips `-Wl,--start-group` from generated ninja files (wasm-ld lacks it).
Delivers `libglib-2.0.a`, `libgobject-2.0.a`, `libgio-2.0.a`, `libgmodule-2.0.a`, headers, and `.pc` files.
CLI tools (`gio`, `gtester`, …) may link but are not required for GTK3 static builds.

## gdk-pixbuf

Static meson build (2.42.12). PNG loader compiled in via `-Dbuiltin_loaders=png`; all other
loaders disabled. Patches:

- `wasm-no-modules.patch` — force `USE_GMODULE=false` (no dlopen / loadable modules).
- `wasm-no-utils.patch` — skip `gdk-pixbuf-csource`, `gdk-pixbuf-query-loaders`, etc. on cross
  builds (static PNG is builtin; utilities need extra link deps).

Delivers `libgdk_pixbuf-2.0.a`, headers, and `gdk-pixbuf-2.0.pc`.

## pango

Static meson build (1.54.0) with fontconfig/cairo/freetype/harfbuzz/fribidi. Extra
`buildInputs` pull in transitive `.pc` deps (libpng, zlib, expat, pixman, X11) for meson
configure. Patches:

- `wasm-cairo-ft-fontconfig.patch` — skip cairo-ft FontConfig link probe on cross builds.
- `wasm-no-utils.patch` — skip `utils/` and `tools/` programs on cross builds.

Delivers `libpango-1.0.a`, `libpangoft2-1.0.a`, `libpangocairo-1.0.a`, headers, and `.pc` files.

## atk

Static meson build (2.38.0). Patch `wasm-no-tests.patch` skips test executables on cross builds.
Delivers `libatk-1.0.a`, headers, and `atk.pc`.

## libepoxy

Static meson build (1.5.10) with X11 + GLX dispatch tables (no libGL link). Required by GDK GL
context code. Delivers `libepoxy.a`, `epoxy/gl.h`, `epoxy/glx.h`, and `epoxy.pc`.

## gtk+3

Static meson build (3.24.52), X11 backend only (`wayland_backend=false`, `broadway_backend=false`).
`builtin_immodules=all` compiles input methods into `libgtk-3.a` (no dlopen). `print_backends=file`
only; cups/colord/cloudproviders/tracker3 disabled; atk-bridge optional (no at-spi2-atk in overlay).

Patches:

- `wasm-no-atk-bridge.patch` / `wasm-atk-bridge-guard.patch` / `wasm-atk-bridge-meson.patch` —
  make `atk-bridge-2.0` optional; skip `atk_bridge_adaptor_init` when absent.
- `wasm-no-utils.patch` — skip gtk CLI tools on cross builds.
- `wasm-no-print-modules.patch` — skip shared print-backend modules (no `.so` dlopen).
- `wasm-no-docs.patch` — skip `docs/tools` and `docs/reference` on cross builds.
- `glib-compat.h` — shim `g_variant_builder_init_static` for host gdbus-codegen vs glib 2.82 sysroot.

`cairo` rebuilt with `-Dglib=enabled` for `cairo-gobject`. `env.NIX_CFLAGS_COMPILE=-DHAVE_XSYNC=1`
works around meson cross-check missing XSync. Host `pkgs.glib` supplies gdbus-codegen / glib-mkenums.

Delivers `libgtk-3.a` (~12 MB), `libgdk-3.a`, `libgailutil-3.a`, headers, and
`gtk+-3.0.pc` / `gtk+-x11-3.0.pc` / `gdk-x11-3.0.pc`.

### GTK stack remaining blockers (Firefox / full browser)

- **at-spi2-atk** not packaged (accessibility bridge; GTK builds without it)
- **Print backends** not loadable at runtime (file backend module not built; printing disabled)
- **gsettings-desktop-schemas** not in overlay (theme/settings; may need stub schemas for some widgets)
- **Host glib 2.88 gdbus-codegen** vs **wasm glib 2.82** — compat header covers current dbus glue;
  upgrading wasm glib to ≥2.84 would be cleaner long-term
- Firefox still blocked on fork/mmap/rust-toolchain (see above); gtk3 static libs are now available to link
