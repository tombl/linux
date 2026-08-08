{
  pkgs,
  stdenv,
  xorgproto,
  zlib,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libfontenc-1.1.9.tar.xz";
    hash = "sha256-nYOScFyxCAPV/h0n0jbLqz9mTiaEHOAZFru+Qwzyc+I=";
  },
}:

stdenv.mkDerivation {
  pname = "libfontenc";
  version = "1.1.9";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    zlib
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}
