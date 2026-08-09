{
  pkgs,
  stdenv,
  zlib,
  src ? pkgs.fetchurl {
    url = "https://downloads.sourceforge.net/libpng/libpng-1.6.58.tar.xz";
    hash = "sha256-KOtAP1Hw90BSSRMs7P6C6lwO+X8bMsWmWCiBSuDTR3U=";
  },
}:

stdenv.mkDerivation {
  pname = "libpng";
  version = "1.6.58";
  inherit src;

  buildInputs = [ zlib ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}
