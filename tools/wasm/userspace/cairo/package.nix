{
  pkgs,
  stdenv,
  lib,
  pixman,
  freetype,
  fontconfig,
  libpng,
  zlib,
  libX11,
  libXrender,
  libXext,
  xorgproto,
  src ? pkgs.fetchurl {
    url = "https://cairographics.org/releases/cairo-1.18.4.tar.xz";
    hash = "sha256-RF7YIIpuSCPeEianTKMZ02AOg/Y2n5mxQmUAZZnDLMs=";
  },
}:

stdenv.mkDerivation {
  pname = "cairo";
  version = "1.18.4";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
  ];

  buildInputs = [
    pixman
    freetype
    fontconfig
    libpng
    zlib
    libX11
    libXrender
    libXext
    xorgproto
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonOption "tests" "disabled")
    (lib.mesonOption "xlib" "enabled")
    (lib.mesonOption "xcb" "disabled")
    (lib.mesonOption "glib" "disabled")
    (lib.mesonOption "lzo" "disabled")
    (lib.mesonOption "symbol-lookup" "disabled")
    (lib.mesonOption "spectre" "disabled")
  ];

  mesonBuildType = "release";

  postPatch = ''
    substituteInPlace version.py \
      --replace '#!/usr/bin/env python3' '#!${pkgs.python3}/bin/python3'
  '';

  meta = {
    description = "Cairo 2D graphics library (Xlib backend)";
    broken = true; # cairo-xlib-xrender-private.h conflicts with xorgproto Render 0.11 types
  };
}
