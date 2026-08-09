{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXext,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXinerama-1.1.6.tar.xz";
    hash = "sha256-0A/BWZwwPcXLwSK4BovcdAXW/LGQYPRZf8Ub06i+Udc=";
  },
}:

stdenv.mkDerivation {
  pname = "libXinerama";
  version = "1.1.6";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXext
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
