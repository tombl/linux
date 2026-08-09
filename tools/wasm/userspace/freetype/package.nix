{
  pkgs,
  stdenv,
  lib,
  zlib,
  libpng,
  src ? pkgs.fetchurl {
    url = "https://download.savannah.gnu.org/releases/freetype/freetype-2.14.3.tar.xz";
    hash = "sha256-NrxPHMQTM1No7mVsQq/KZcWjmH6HaMwozxG6d154Wl8=";
  },
}:

stdenv.mkDerivation {
  pname = "freetype";
  version = "2.14.3";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
  ];

  buildInputs = [
    zlib
    libpng
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonOption "mmap" "disabled")
    (lib.mesonOption "harfbuzz" "disabled")
    (lib.mesonOption "brotli" "disabled")
    (lib.mesonOption "bzip2" "disabled")
    (lib.mesonOption "png" "enabled")
    (lib.mesonOption "zlib" "enabled")
  ];

  mesonBuildType = "release";
}
