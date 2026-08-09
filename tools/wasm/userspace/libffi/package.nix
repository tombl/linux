{
  pkgs,
  stdenv,
  lib,
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
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--disable-assembly";

  meta.broken = true; # closures.c uses mmap for executable trampolines (unavailable on wasm musl)
}
