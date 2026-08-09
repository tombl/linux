{
  pkgs,
  stdenv,
  lib,
  glib,
  libpng,
  zlib,
  src ? pkgs.fetchurl {
    url = "https://download.gnome.org/sources/gdk-pixbuf/2.42/gdk-pixbuf-2.42.12.tar.xz";
    hash = "sha256-uVBbNEW5p+SM7TR2DDvLc+lm3zrJTJWhSMtmmrdI48c=";
  },
}:

stdenv.mkDerivation {
  pname = "gdk-pixbuf";
  version = "2.42.12";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
    glib
  ];

  buildInputs = [
    glib
    libpng
    zlib
  ];

  propagatedBuildInputs = [
    glib
    libpng
    zlib
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonOption "builtin_loaders" "png")
    (lib.mesonEnable "png" true)
    (lib.mesonEnable "jpeg" false)
    (lib.mesonEnable "gif" false)
    (lib.mesonEnable "tiff" false)
    (lib.mesonEnable "others" false)
    (lib.mesonEnable "introspection" false)
    (lib.mesonBool "gio_sniffing" false)
    (lib.mesonBool "man" false)
    (lib.mesonBool "tests" false)
    (lib.mesonBool "installed_tests" false)
    (lib.mesonBool "gtk_doc" false)
  ];

  mesonBuildType = "release";

  patches = [
    ./wasm-no-modules.patch
    ./wasm-no-utils.patch
  ];

  postPatch = ''
    chmod +x build-aux/*
    patchShebangs build-aux
  '';

  postConfigure = ''
    find . -name build.ninja -exec \
      sed -i 's/-Wl,--start-group//g; s/-Wl,--end-group//g; s/ --start-group//g; s/ --end-group//g' {} +
  '';

  meta = {
    description = "GdkPixbuf for wasm32-unknown-linux-musl (static, builtin PNG loader only)";
  };
}
