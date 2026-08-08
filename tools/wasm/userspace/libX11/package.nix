{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  xtrans,
  libXau,
  libxcb,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libX11-1.8.13.tar.xz";
    hash = "sha256-aWBvSFwsB8FO9k91t7sybUhYevM3ldmrPmB8C1+U8Rw=";
  },
}:

stdenv.mkDerivation {
  pname = "libX11";
  version = "1.8.13";
  inherit src;

  # makekeys and similar host tools are built with the build compiler.
  depsBuildBuild = [ pkgs.stdenv.cc ];
  nativeBuildInputs = [ pkgs.pkg-config ];

  buildInputs = [
    xorgproto
    xtrans
    libXau
    libxcb
  ];

  propagatedBuildInputs = [
    xorgproto
    libxcb
  ];

  # libX11 1.8 requires libxcb; we link it statically. Compose cache and
  # loadable i18n touch mmap-ish paths — disable them on this target.
  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-composecache"
    "--disable-loadable-i18n"
    "--disable-loadable-xcursor"
    "--enable-xthreads"
    "--disable-specs"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";

  # CONFIG_SITE already answers mmap probes; reinforce for this package.
  preConfigure = ''
    export ac_cv_func_mmap_fixed_mapped=no
  '';
}
