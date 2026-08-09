{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXfixes,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXcomposite-0.4.7.tar.xz";
    hash = "sha256-i98xCWf0hFA/pRcUz5e/8HI9m2c+Duy/krP5fAYMjMs=";
  },
}:

stdenv.mkDerivation {
  pname = "libXcomposite";
  version = "0.4.7";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXfixes
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
