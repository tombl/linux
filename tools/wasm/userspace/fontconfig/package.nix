{
  pkgs,
  stdenv,
  lib,
  expat,
  freetype,
  zlib,
  libpng,
  src ? pkgs.fetchurl {
    url = "https://gitlab.freedesktop.org/api/v4/projects/890/packages/generic/fontconfig/2.18.1/fontconfig-2.18.1.tar.xz";
    hash = "sha256-IwDz2/pyU7OkT0/uzbyN+kXd5dws+3H86vMfOUy0EDE=";
  },
}:

stdenv.mkDerivation {
  pname = "fontconfig";
  version = "2.18.1";
  inherit src;

  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.python3
    pkgs.gperf
  ];

  buildInputs = [
    expat
    freetype
    zlib
    libpng
  ];

  propagatedBuildInputs = [
    expat
    freetype
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-docs"
    "--sysconfdir=/etc"
    "--with-cache-dir=/var/cache/fontconfig"
    "--with-default-fonts=/usr/share/fonts"
    "--with-arch=${stdenv.hostPlatform.parsed.cpu.name}"
  ]
  ++ lib.optionals (stdenv.hostPlatform != stdenv.buildPlatform) [
    "ac_cv_va_copy=C99"
  ];

  # Build generated headers via the normal subdir order; skip fc-cache (fork).
  buildPhase = ''
    runHook preBuild
    make SUBDIRS='fontconfig fc-case fc-lang fc-const src'
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    make -C src install-libLTLIBRARIES
    mkdir -p "$out/include/fontconfig" "$out/lib/pkgconfig"
    install -Dm644 fontconfig/fontconfig.h "$out/include/fontconfig/fontconfig.h"
    install -Dm644 fontconfig/fcprivate.h "$out/include/fontconfig/fcprivate.h"
    install -Dm644 fontconfig/fcfreetype.h "$out/include/fontconfig/fcfreetype.h"
    install -Dm644 fontconfig.pc "$out/lib/pkgconfig/fontconfig.pc"
    runHook postInstall
  '';
}
