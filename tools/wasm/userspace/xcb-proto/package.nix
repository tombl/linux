{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/proto/xcb-proto-1.17.0.tar.xz";
    hash = "sha256-LBus0hEPR5n3TebrtxS5TPb4D7ESMWsSGUgP0iViFIw=";
  },
}:

stdenv.mkDerivation {
  pname = "xcb-proto";
  version = "1.17.0";
  inherit src;

  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.python3
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}
