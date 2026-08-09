{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXrender-0.9.12.tar.xz";
    hash = "sha256-uDISjaSLOcjWCCJEgXQ0A60Wkb9OVU5L6cF03xcdG5c=";
  },
}:

stdenv.mkDerivation {
  pname = "libXrender";
  version = "0.9.12";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
