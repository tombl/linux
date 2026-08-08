{
  pkgs,
  stdenv,
  xorgproto,
  libX11,
  libXt,
  libXext,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXmu-1.3.1.tar.xz";
    hash = "sha256-gamelMRQHoHEJ8uqShF0i1hJM+lLehVoMMNiElaFe8Q=";
  },
}:

stdenv.mkDerivation {
  pname = "libXmu";
  version = "1.3.1";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXt
    libXext
  ];
  propagatedBuildInputs = [
    xorgproto
    libXt
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-docs"
  ];
}
