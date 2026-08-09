{
  pkgs,
  stdenv,
  lib,
  freetype,
  zlib,
  libpng,
  src ? pkgs.fetchurl {
    url = "https://github.com/harfbuzz/harfbuzz/releases/download/13.2.1/harfbuzz-13.2.1.tar.xz";
    hash = "sha256-ZpXaPrfhvgqjCS/k2BQzoztH9FGSWcdZ1ynjqaVcFCk=";
  },
}:

stdenv.mkDerivation {
  pname = "harfbuzz";
  version = "13.2.1";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
  ];

  buildInputs = [
    freetype
    zlib
    libpng
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonOption "tests" "disabled")
    (lib.mesonOption "benchmark" "disabled")
    (lib.mesonOption "cairo" "disabled")
    (lib.mesonOption "chafa" "disabled")
    (lib.mesonOption "icu" "disabled")
    (lib.mesonOption "glib" "disabled")
    (lib.mesonOption "gobject" "disabled")
    (lib.mesonOption "introspection" "disabled")
    (lib.mesonOption "freetype" "enabled")
    (lib.mesonOption "docs" "disabled")
  ];

  mesonBuildType = "release";

  # gen-hb-version.py tries to sync back into $src/; skip that in the sandbox.
  postPatch = ''
    for f in src/*.py; do
      substituteInPlace "$f" --replace '#!/usr/bin/env python3' '#!${pkgs.python3}/bin/python3'
    done
    sed -i '/^baseline_filename =/,/^$/d' src/gen-hb-version.py
  '';
}
