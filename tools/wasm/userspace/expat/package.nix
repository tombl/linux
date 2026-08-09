{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz";
    hash = "sha256-OtibhYjmZEvU5JmBSA1IshKJ7rvNTwoaSvscKfmbarQ=";
  },
}:

stdenv.mkDerivation {
  pname = "expat";
  version = "2.8.2";
  inherit src;

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--without-docbook"
  ];
}
