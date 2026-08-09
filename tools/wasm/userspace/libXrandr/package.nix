{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXext,
  libXrender,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXrandr-1.5.5.tar.xz";
    hash = "sha256-crkiwudlQ06enwlgFIBwvUUEsogmPihopMzOG3zydno=";
  },
}:

stdenv.mkDerivation {
  pname = "libXrandr";
  version = "1.5.5";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXext
    libXrender
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
