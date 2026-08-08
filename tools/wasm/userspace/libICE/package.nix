{
  pkgs,
  stdenv,
  xorgproto,
  xtrans,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libICE-1.1.2.tar.xz";
    hash = "sha256-l05O1BQiXrPHFphd+XCfTajSKmeiiQBmvG38ia0phiU=";
  },
}:

stdenv.mkDerivation {
  pname = "libICE";
  version = "1.1.2";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    xtrans
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-docs"
    "--disable-specs"
  ];
}