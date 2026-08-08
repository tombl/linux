{
  pkgs,
  stdenv,
  xorgproto,
  xtrans,
  libfontenc,
  zlib,
  src ? pkgs.fetchurl {
    # TinyX pkg-config looks for `xfont` (libXfont 1.x), not xfont2.
    url = "https://www.x.org/releases/individual/lib/libXfont-1.5.4.tar.bz2";
    hash = "sha256-Gn90kHdMh/IFLRRtHg5kUY0y5oSBhKGGVOjQu1eIMkI=";
  },
}:

stdenv.mkDerivation {
  pname = "libXfont";
  version = "1.5.4";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    xtrans
    libfontenc
    zlib
  ];
  propagatedBuildInputs = [ xorgproto ];

  # Bitmap fonts only; skip FreeType to keep the dependency closure small.
  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-devel-docs"
    "--disable-freetype"
  ];
}
