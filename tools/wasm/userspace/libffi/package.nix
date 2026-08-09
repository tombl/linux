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
    "--disable-exec-static-tramp"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--disable-assembly";

  # closures.c forces FFI_MMAP_EXEC_WRIT on __linux__; use malloc trampolines instead.
  env.NIX_CFLAGS_COMPILE = "-DFFI_MMAP_EXEC_WRIT=0";

  meta.broken = true; # closures.c still hits mmap via dlmalloc even with FFI_MMAP_EXEC_WRIT=0
}
