{
  pkgs,
  stdenv,
  lib,
  src ? pkgs.fetchurl {
    url = "https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.46/pcre2-10.46.tar.bz2";
    hash = "sha256-FfvFq6a+7gsXrssEYCrjlDI5OroevY45t8q/fbiDKZ8=";
  },
}:

stdenv.mkDerivation {
  pname = "pcre2";
  version = "10.46";
  inherit src;

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--enable-pcre2-16"
    "--enable-pcre2-32"
    "--enable-jit=no"
  ];
}
