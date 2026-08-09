{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXrender,
  libXfixes,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXcursor-1.2.3.tar.xz";
    hash = "sha256-/elALdTP552nHi2Wu5gK/F5v9Pin10wVnhlmr7KywsA=";
  },
}:

stdenv.mkDerivation {
  pname = "libXcursor";
  version = "1.2.3";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXrender
    libXfixes
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
