{
  pkgs,
  stdenv,
  lib,
  src ? pkgs.fetchurl {
    url = "https://cairographics.org/releases/pixman-0.46.4.tar.gz";
    hash = "sha256-0JxE68O9W+5wIcefki/o+y+1f3Mg9V6X/5kU0jRqWRw=";
  },
}:

stdenv.mkDerivation {
  pname = "pixman";
  version = "0.46.4";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonOption "gtk" "disabled")
    (lib.mesonOption "libpng" "disabled")
    (lib.mesonOption "tests" "disabled")
    (lib.mesonOption "demos" "disabled")
    (lib.mesonOption "timers" "false")
    (lib.mesonOption "loongson-mmi" "disabled")
    (lib.mesonOption "mmx" "disabled")
    (lib.mesonOption "sse2" "disabled")
    (lib.mesonOption "ssse3" "disabled")
    (lib.mesonOption "vmx" "disabled")
    (lib.mesonOption "arm-simd" "disabled")
    (lib.mesonOption "neon" "disabled")
    (lib.mesonOption "a64-neon" "disabled")
    (lib.mesonOption "mips-dspr2" "disabled")
    (lib.mesonOption "rvv" "disabled")
    (lib.mesonOption "gnu-inline-asm" "disabled")
    (lib.mesonOption "openmp" "disabled")
  ];

  mesonBuildType = "release";
}
