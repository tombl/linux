{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXext,
  libXi,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXtst-1.2.5.tar.xz";
    hash = "sha256-tQ1MJblwCadEcGwQOcWY9NjmSRDJ/eOBmU4criNdkkI=";
  },
}:

stdenv.mkDerivation {
  pname = "libXtst";
  version = "1.2.5";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXext
    libXi
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
