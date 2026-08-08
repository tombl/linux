{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/xtrans-1.6.0.tar.xz";
    hash = "sha256-+q/qFmvyRRoXPZ1ZM1KUDsZAQUXF0dpcITQjzk01npI=";
  },
}:

stdenv.mkDerivation {
  pname = "xtrans";
  version = "1.6.0";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}
