{
  pkgs,
  stdenv,
  lib,
  wasmLinuxSrc ? ./wasm-linux,
  src ? pkgs.fetchurl {
    url = "https://github.com/libffi/libffi/releases/download/v3.4.8/libffi-3.4.8.tar.gz";
    hash = "sha256-vJhCoYiYv6yw7RJSxP68x+ePoTn9J/3Ho+MNnZNWEZs=";
  },
}:

stdenv.mkDerivation {
  pname = "libffi";
  version = "3.4.8";
  inherit src;

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--with-gcc-arch=generic"
    "--disable-exec-static-tramp"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--disable-assembly";

  # closures.c forces FFI_MMAP_EXEC_WRIT on __linux__; wasm-no-mmap-closures.patch
  # keeps malloc trampolines on __wasm__. wasm-linux-port.patch routes
  # wasm32-unknown-linux-musl to src/wasm-linux/ (no Emscripten).
  env.NIX_CFLAGS_COMPILE = "-DFFI_MMAP_EXEC_WRIT=0 -DFFI_WASM_LINUX_PORT=1";

  patches = [
    ./wasm-no-mmap-closures.patch
    ./wasm-linux-port.patch
  ];

  postPatch = ''
    cp -r ${wasmLinuxSrc} src/wasm-linux
  '';

  meta = {
    description = "libffi for wasm32-unknown-linux-musl (wasm-linux port, malloc closures)";
  };
}
