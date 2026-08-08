{
  pkgs,
  stdenv,
  xorgproto,
  xtrans,
  libICE,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libSM-1.2.6.tar.xz";
    hash = "sha256-vnwKvbFcv9KaxiVzwcguh3+dQEetFTIefql9HkPYNb4=";
  },
}:

stdenv.mkDerivation {
  pname = "libSM";
  version = "1.2.6";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    xtrans
    libICE
  ];
  propagatedBuildInputs = [
    xorgproto
    libICE
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--without-libuuid"
    "--disable-docs"
  ];
}
