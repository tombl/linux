{
  pkgs,
  stdenv,
  lib,
  xcb-proto,
  libXau,
  libpthread-stubs,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libxcb-1.17.0.tar.xz";
    hash = "sha256-WZ6/mZZxD+pxYi5uGE86itW0PQ5fqMTkBxI8iKWabVU=";
  },
}:

stdenv.mkDerivation {
  pname = "libxcb";
  version = "1.17.0";
  inherit src;

  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.python3
  ];

  buildInputs = [
    xcb-proto
    libXau
    libpthread-stubs
  ];

  propagatedBuildInputs = [
    libXau
    xcb-proto
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-devel-docs"
    "--without-doxygen"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
