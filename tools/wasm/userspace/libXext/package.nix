{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXext-1.3.7.tar.xz";
    hash = "sha256-bGQ8cDXNrPZ6/WjyXQG5DviJ1UbJ/NfArffCz5Hjoy0=";
  },
}:

stdenv.mkDerivation {
  pname = "libXext";
  version = "1.3.7";
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
