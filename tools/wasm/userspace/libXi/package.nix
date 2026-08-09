{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXext,
  libXfixes,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXi-1.8.3.tar.xz";
    hash = "sha256-etYAVvAa9PeGz+k7OncHRHcRYm/I2iY3vscakECbq+U=";
  },
}:

stdenv.mkDerivation {
  pname = "libXi";
  version = "1.8.3";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXext
    libXfixes
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
