{
  pkgs,
  stdenv,
  lib,
  libffi,
  pcre2,
  zlib,
  src ? pkgs.fetchurl {
    url = "https://download.gnome.org/sources/glib/2.82/glib-2.82.1.tar.xz";
    hash = "sha256-R4Y0RAv1LuTsRCjVWHhzmMC+awQ8UhvrMIM0s9tEiaY=";
  },
}:

stdenv.mkDerivation {
  pname = "glib";
  version = "2.82.1";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
    pkgs.perl
  ];

  buildInputs = [
    libffi
    pcre2
    zlib
  ];

  propagatedBuildInputs = [
    libffi
    pcre2
    zlib
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonOption "tests" "disabled")
    (lib.mesonOption "installed_tests" "disabled")
    (lib.mesonOption "introspection" "disabled")
    (lib.mesonOption "documentation" "disabled")
    (lib.mesonOption "man-pages" "disabled")
    (lib.mesonOption "nls" "disabled")
    (lib.mesonOption "libmount" "disabled")
    (lib.mesonOption "selinux" "disabled")
    (lib.mesonOption "xattr" "disabled")
    (lib.mesonOption "libelf" "disabled")
    (lib.mesonOption "glib_debug" "disabled")
  ];

  mesonBuildType = "release";

  patches = [
    ./wasm-no-fork.patch
    ./wasm-no-fork-backtrace.patch
    ./wasm-no-mmap-gmappedfile.patch
  ];

  postPatch = ''
    for f in glib/*.py gio/*.py gobject/*.py tools/*.py; do
      [ -f "$f" ] || continue
      substituteInPlace "$f" --replace '#!/usr/bin/env python3' '#!${pkgs.python3}/bin/python3'
    done
    patchShebangs glib/gen-unicode-tables.pl
  '';

  meta = {
    description = "GLib for wasm32-unknown-linux-musl (static, posix_spawn, no mmap)";
  };
}
