# Wasm userspace (GUI stack)

Nix package definitions for a `wasm32-unknown-linux-musl` userspace overlay on top of the linuxwasm distro flake (`wasmpkgs`). Adds interactive tools and a TinyX/Xaw GUI path that targets the guest framebuffer.

## Packages

| Attr | Role |
| --- | --- |
| `htop` | Process viewer (ncurses, static) |
| `p7zip` | 7-Zip Alone2 (`7z` / `7za` / `7zz`), `DISABLE_RAR=1` (needs wasm libc++) |
| `xorgproto` … `libXaw` | Static X11 client libraries |
| *(deferred)* `gcc` | Native wasm gcc toolchain — out of scope for this pass |
| `libfontenc` / `libXfont` | Font support for TinyX |
| `font-misc-misc` | Misc bitmap fonts |
| `tinyx` | `Xfbdev` with no-mmap / no-VT patches |
| `xterm` | Terminal linked against the static Xaw stack |
| `gui-rootfs` | ext4 image: busybox + agent + htop + p7zip + TinyX + xterm |

`libxcb`, `xcb-proto`, and `libpthread-stubs` are also in the scope because modern `libX11` requires them (linked statically).

## Build

From a checkout that can import the distro flake as `wasmpkgs`:

```nix
# example flake fragment
let
  wasmpkgs = linuxwasm.legacyPackages.${system};
  userspace = import ./tools/wasm/userspace { inherit pkgs wasmpkgs; };
in
userspace.gui-rootfs
```

Or evaluate directly against a local distro tree:

```bash
nix build -f - <<'EOF'
let
  pkgs = import <nixpkgs> {};
  wasmpkgs = import /path/to/distro/packages { inherit pkgs; };
in
(import ./tools/wasm/userspace { inherit pkgs wasmpkgs; }).htop
EOF
```

Individual packages: `userspace.htop`, `userspace.tinyx`, `userspace.xterm`, …

The GUI demo rootfs is `userspace.gui-rootfs`. Its `/init` starts `Xfbdev` then `xterm -e htop`.

## Patches

- `patches/tinyx-no-mmap-fb.patch` — malloc framebuffer + periodic `pwrite` flush (forced shadow)
- `patches/tinyx-no-vt.patch` — no `/dev/tty0`; use `/dev/hvc0` or `/dev/console`; ignore failed VT ioctls
