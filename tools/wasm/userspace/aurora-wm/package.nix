{
  pkgs,
  rust-toolchain,
  src ? pkgs.fetchFromGitHub {
    owner = "ecooxai";
    repo = "aurora-wm";
    rev = "dc82ba0830a8b8c0dd56431a79867f343da610c6";
    hash = "sha256-V/erR76M/cdvAYuZ0uqTLmVfnZYOr6Civ7FXRd3FKfk=";
  },
}:

rust-toolchain.buildRustPackage {
  pname = "aurora-wm";
  version = "0.3.0";
  inherit src;

  cargoLock.lockFile = ./Cargo.lock;

  patches = [
    # wasm32-linux musl has openpty/posix_spawn but no fork()/forkpty().
    ./posix-spawn-pty.patch
  ];

  # Keep the release profile from Cargo.toml (fat LTO); binaries land in $out/bin.
  # Compositor is optional at runtime (--compositor=no); TinyX lacks Composite.
}
