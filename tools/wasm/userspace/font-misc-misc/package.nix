{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/font/font-misc-misc-1.1.3.tar.xz";
    hash = "sha256-eavjYfWLshren1ZYmOSGMAzhzGIdUoW+wm4Utqhhj+0=";
  },
}:

stdenv.mkDerivation {
  pname = "font-misc-misc";
  version = "1.1.3";
  inherit src;

  # bdftopcf / mkfontscale / font-util run on the build platform.
  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.bdftopcf
    pkgs.mkfontscale
    pkgs.font-util
  ];

  buildInputs = [ pkgs.font-util ];

  configureFlags = [
    "--with-fontrootdir=$(out)/share/fonts/X11"
  ];
}