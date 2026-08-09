# aurora-wm (moved)

Aurora WM packaging for wasm is **pacman**, not Nix.

Canonical repo: <https://github.com/woiceatus/aurora-wm-wasm>

```bash
git clone https://github.com/woiceatus/aurora-wm-wasm.git
cd aurora-wm-wasm

# native Arch package
makepkg -f

# wasm32-unknown-linux-musl guest binaries
AURORA_TARGET=wasm32-unknown-linux-musl makepkg -f
# or: ./wasm/build.sh --release
```

`gui-rootfs` starts `/bin/aurora-wm` when present; otherwise it falls back to `xterm`.
Install the pacman-built `aurora-wm` + `aurora-files` into the guest image (e.g. copy
`usr/bin/*` from the `.pkg.tar.zst` into the rootfs `/bin`).
