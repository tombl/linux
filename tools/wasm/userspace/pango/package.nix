{
  pkgs,
  stdenv,
  lib,
  glib,
  cairo,
  freetype,
  fontconfig,
  harfbuzz,
  fribidi,
  libpng,
  zlib,
  expat,
  pixman,
  libX11,
  libXext,
  libXrender,
  libxcb,
  xorgproto,
  src ? pkgs.fetchurl {
    url = "https://download.gnome.org/sources/pango/1.54/pango-1.54.0.tar.xz";
    hash = "sha256-ip7tdQIe5zTX/A/fOmXDu6Ud/v5K5RqbQUpgxwstHtg=";
  },
}:

stdenv.mkDerivation {
  pname = "pango";
  version = "1.54.0";
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
    cairo
    freetype
    fontconfig
    harfbuzz
    fribidi
    libpng
    zlib
    expat
    pixman
    libX11
    libXext
    libXrender
    libxcb
    xorgproto
  ];

  propagatedBuildInputs = [
    glib
    cairo
    freetype
    fontconfig
    harfbuzz
    fribidi
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonEnable "cairo" true)
    (lib.mesonEnable "fontconfig" true)
    (lib.mesonEnable "freetype" true)
    (lib.mesonEnable "xft" false)
    (lib.mesonEnable "libthai" false)
    (lib.mesonEnable "introspection" false)
    (lib.mesonBool "documentation" false)
    (lib.mesonBool "build-testsuite" false)
    (lib.mesonBool "build-examples" false)
  ];

  mesonBuildType = "release";

  patches = [
    ./wasm-cairo-ft-fontconfig.patch
    ./wasm-no-utils.patch
  ];

  postConfigure = ''
    find . -name build.ninja -exec \
      sed -i 's/-Wl,--start-group//g; s/-Wl,--end-group//g; s/ --start-group//g; s/ --end-group//g' {} +
  '';

  meta = {
    description = "Pango text layout for wasm32-unknown-linux-musl (static, fontconfig/cairo)";
  };
}
