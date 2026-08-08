{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/font/font-cursor-misc-1.0.4.tar.xz";
    hash = "sha256-JdnJWVATy4yghCBQmZOmQ0yRflPKH+w/Y6zUWhnU+YI=";
  },
}:

stdenv.mkDerivation {
  pname = "font-cursor-misc";
  version = "1.0.4";
  inherit src;

  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.bdftopcf
    pkgs.mkfontscale
    pkgs.font-util
  ];

  buildInputs = [ pkgs.font-util ];

  # Upstream XORG_FONTDIR([misc]) would collide with font-misc-misc's
  # fonts.dir; put the cursor face in its own directory.
  configureFlags = [
    "--with-fontdir=$(out)/share/fonts/X11/cursor"
  ];
}
