{
  pkgs,
  stdenv,
  lib,
  glib,
  atk,
  cairo,
  pango,
  gdk-pixbuf,
  libepoxy,
  expat,
  fribidi,
  libpng,
  zlib,
  pixman,
  freetype,
  fontconfig,
  harfbuzz,
  libX11,
  libXext,
  libXrender,
  libXfixes,
  libXdamage,
  libXcomposite,
  libXcursor,
  libXi,
  libXrandr,
  libXinerama,
  libICE,
  libSM,
  libxcb,
  xorgproto,
  src ? pkgs.fetchurl {
    url = "https://download.gnome.org/sources/gtk/3.24/gtk-3.24.52.tar.xz";
    hash = "sha256-gJMfpHKne5oWT2dA48C0RPrGdwBUYy01p/+dZ55ee58=";
  },
}:

stdenv.mkDerivation {
  pname = "gtk+3";
  version = "3.24.52";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
    pkgs.glib
    gdk-pixbuf
  ];

  buildInputs = [
    glib
    atk
    cairo
    pango
    gdk-pixbuf
    libepoxy
    expat
    fribidi
    libpng
    zlib
    pixman
    freetype
    fontconfig
    harfbuzz
    libX11
    libXext
    libXrender
    libXfixes
    libXdamage
    libXcomposite
    libXcursor
    libXi
    libXrandr
    libXinerama
    libICE
    libSM
    libxcb
    xorgproto
  ];

  propagatedBuildInputs = [
    glib
    atk
    cairo
    pango
    gdk-pixbuf
    libepoxy
    expat
    fribidi
    libX11
    libXext
    libXrender
    libXfixes
    libXdamage
    libXcomposite
    libXcursor
    libXi
    libXrandr
    libXinerama
    libICE
    libSM
  ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonBool "x11_backend" true)
    (lib.mesonBool "wayland_backend" false)
    (lib.mesonBool "broadway_backend" false)
    (lib.mesonBool "win32_backend" false)
    (lib.mesonBool "quartz_backend" false)
    (lib.mesonOption "builtin_immodules" "all")
    (lib.mesonOption "print_backends" "file")
    (lib.mesonOption "colord" "no")
    (lib.mesonBool "cloudproviders" false)
    (lib.mesonBool "tracker3" false)
    (lib.mesonBool "introspection" false)
    (lib.mesonBool "gtk_doc" false)
    (lib.mesonBool "man" false)
    (lib.mesonBool "demos" false)
    (lib.mesonBool "examples" false)
    (lib.mesonBool "tests" false)
    (lib.mesonBool "installed_tests" false)
    (lib.mesonOption "xinerama" "auto")
  ];

  mesonBuildType = "release";

  # Meson cross-checks skip XSync; field is still referenced unconditionally.
  # Host gdbus-codegen may emit g_variant_builder_init_static (glib >= 2.84).
  env.NIX_CFLAGS_COMPILE = "-DHAVE_XSYNC=1 -include ${./glib-compat.h}";

  patches = [
    ./wasm-no-atk-bridge.patch
    ./wasm-atk-bridge-guard.patch
    ./wasm-atk-bridge-meson.patch
    ./wasm-no-utils.patch
    ./wasm-no-print-modules.patch
    ./wasm-no-docs.patch
  ];

  postPatch = ''
    chmod +x build-aux/meson/post-install.py \
      gtk/gen-gtk-gresources-xml.py \
      gtk/gen-rc.py \
      gtk/gentypefuncs.py \
      gdk/gen-gdk-gresources-xml.py
    patchShebangs build-aux/meson/post-install.py \
      gtk/gen-gtk-gresources-xml.py \
      gtk/gen-rc.py \
      gtk/gentypefuncs.py \
      gdk/gen-gdk-gresources-xml.py

    substituteInPlace meson.build \
      --replace 'if not meson.is_cross_build()' 'if false'
  '';

  postConfigure = ''
    find . -name build.ninja -exec \
      sed -i 's/-Wl,--start-group//g; s/-Wl,--end-group//g; s/ --start-group//g; s/ --end-group//g' {} +
  '';

  meta = {
    description = "GTK+ 3 for wasm32-unknown-linux-musl (static, X11 only, no dlopen modules)";
  };
}
