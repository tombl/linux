{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  libSM,
  libICE,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXt-1.3.1.tar.xz";
    hash = "sha256-4Kd0szMk9NTAWxmepFBQ+HIGWG2BZV+L7026Q02TEog=";
  },
}:

stdenv.mkDerivation {
  pname = "libXt";
  version = "1.3.1";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];
  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libSM
    libICE
  ];
  propagatedBuildInputs = [
    xorgproto
    libX11
    libSM
    libICE
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-specs"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
