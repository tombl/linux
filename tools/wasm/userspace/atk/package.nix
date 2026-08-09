{
  pkgs,
  stdenv,
  lib,
  glib,
  src ? pkgs.fetchurl {
    url = "https://download.gnome.org/sources/atk/2.38/atk-2.38.0.tar.xz";
    hash = "sha256-rE3ipO9L1WZQUpUv4WllfmXolcUFff+zwqgQ9hkaDDY=";
  },
}:

stdenv.mkDerivation {
  pname = "atk";
  version = "2.38.0";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
    glib
  ];

  buildInputs = [ glib ];

  propagatedBuildInputs = [ glib ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonBool "introspection" false)
    (lib.mesonBool "docs" false)
  ];

  mesonBuildType = "release";

  patches = [ ./wasm-no-tests.patch ];

  postConfigure = ''
    find . -name build.ninja -exec \
      sed -i 's/-Wl,--start-group//g; s/-Wl,--end-group//g; s/ --start-group//g; s/ --end-group//g' {} +
  '';

  meta = {
    description = "ATK accessibility toolkit for wasm32-unknown-linux-musl (static)";
  };
}
