{
  lib,
  pkgs,
  rust-toolchain,
  src ? pkgs.fetchFromGitHub {
    owner = "ecooxai";
    repo = "aurora-wm";
    rev = "dc82ba0830a8b8c0dd56431a79867f343da610c6";
    hash = "sha256-V/erR76M/cdvAYuZ0uqTLmVfnZYOr6Civ7FXRd3FKfk=";
  },
}:

let
  # rustix still lists linux-raw-sys as a target dependency on unsupported
  # arches; reuse arm (ILP32 LE) tables so the crate can compile.
  linux-raw-sys-wasm = pkgs.runCommand "linux-raw-sys-0.12.1" { } ''
    cp -r ${
      pkgs.fetchCrate {
        pname = "linux-raw-sys";
        version = "0.12.1";
        hash = "sha256-syk6TlGevol6xQAS8HtCnIjDGBcLKcZ762areCAhvGM=";
      }
    } $out
    chmod -R u+w $out
    sed -i 's/target_arch = "arm"/any(target_arch = "arm", target_arch = "wasm32")/g' \
      $out/src/lib.rs
  '';

  # Patches for wasm32-unknown-linux-musl:
  # - ioctl opcode consts have no wasm32 arm; treat like arm
  # - STATX__RESERVED musl branch must require linux_raw_dep (else double-define
  #   when build.rs selects the libc backend without linux_raw_dep)
  # - force libc backend without linux_raw_dep on wasm32
  rustix-wasm = pkgs.runCommand "rustix-1.1.4" { } ''
    cp -r ${
      pkgs.fetchCrate {
        pname = "rustix";
        version = "1.1.4";
        hash = "sha256-KOZKGzxdH4rsR64x+NFWb+yLPRSt5vdA3eQ38SI9Jmk=";
      }
    } $out
    chmod -R u+w $out

    # ioctl consts: include wasm32 with the common Linux encoding (same as arm).
    sed -i 's/target_arch = "csky"/target_arch = "csky",\n    target_arch = "wasm32"/' \
      $out/src/ioctl/linux.rs

    # Fix STATX__RESERVED double-definition on musl + libc backend.
    sed -i 's/#\[cfg(target_env = "musl")\]/#[cfg(all(linux_raw_dep, target_env = "musl"))]/' \
      $out/src/backend/libc/fs/syscalls.rs

    # Prefer libc backend without linux_raw_dep on wasm32 (no inline asm).
    sed -i '/let cfg_no_linux_raw = var("CARGO_CFG_RUSTIX_NO_LINUX_RAW").is_ok();/a\
    let cfg_no_linux_raw = cfg_no_linux_raw || arch == "wasm32";' \
      $out/build.rs
  '';
in
rust-toolchain.buildRustPackage {
  pname = "aurora-wm";
  version = "0.3.0";
  inherit src;

  cargoLock.lockFile = ./Cargo.lock;
  cargoPathOverrides = [
    linux-raw-sys-wasm
    rustix-wasm
  ];

  patches = [
    # wasm32-linux musl has openpty/posix_spawn but no fork()/forkpty().
    ./posix-spawn-pty.patch
  ];

  # Fat LTO needs .llvmbc in object files; the wasm clang/rustc link path
  # does not emit it. Keep thin/off release LTO for a successful link.
  postPatch = ''
    sed -i 's/lto = "fat"/lto = false/' Cargo.toml
  '';

  # musl has no fork() on wasm32; Rust std still references it. Link a stub.
  preBuild = ''
    $CC -c ${./fork-stub.c} -o $TMPDIR/fork-stub.o
    export CARGO_TARGET_WASM32_UNKNOWN_LINUX_MUSL_RUSTFLAGS="''${CARGO_TARGET_WASM32_UNKNOWN_LINUX_MUSL_RUSTFLAGS:+$CARGO_TARGET_WASM32_UNKNOWN_LINUX_MUSL_RUSTFLAGS }-C link-arg=$TMPDIR/fork-stub.o"
  '';

  # Install both WM and file manager onto PATH (/bin via apk).
  installPhase = ''
    runHook preInstall
    install -Dm755 target/wasm32-unknown-linux-musl/release/aurora-wm \
      $out/bin/aurora-wm
    install -Dm755 target/wasm32-unknown-linux-musl/release/aurora-files \
      $out/bin/aurora-files
    runHook postInstall
  '';

  meta = {
    description = "Aurora X11 window manager for the wasm framebuffer guest";
    mainProgram = "aurora-wm";
  };
}
