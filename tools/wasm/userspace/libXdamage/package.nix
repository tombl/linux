{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libXfixes,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXdamage-1.1.7.tar.xz";
    hash = "sha256-EnBn9SHT7kZ7l7yxRa66EHjiRU1EjodI65hNWzl73iQ=";
  },
}:

stdenv.mkDerivation {
  pname = "libXdamage";
  version = "1.1.7";
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
