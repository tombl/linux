{
  pkgs,
  stdenv,
  lib,
  pixman,
  freetype,
  fontconfig,
  libpng,
  zlib,
  glib,
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
    glib
  ];

  buildInputs = [
    pixman
    freetype
    fontconfig
    libpng
    zlib
    glib
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
    (lib.mesonOption "glib" "enabled")
    (lib.mesonOption "lzo" "disabled")
    (lib.mesonOption "symbol-lookup" "disabled")
    (lib.mesonOption "spectre" "disabled")
  ];

  propagatedBuildInputs = [ glib ];

  mesonBuildType = "release";

  # meson cross-check misses ctime_r on wasm32-musl; cairo's fallback clashes with musl.
  env.NIX_CFLAGS_COMPILE = "-DHAVE_CTIME_R=1";

  postPatch = ''
    substituteInPlace version.py \
      --replace '#!/usr/bin/env python3' '#!${pkgs.python3}/bin/python3'

    # xorgproto Render 0.11 defines gradient types in Xrender.h; skip cairo fallbacks.
    substituteInPlace src/cairo-xlib-xrender-private.h \
      --replace '#define XRenderCreateLinearGradient			_int_consume

typedef struct _XLinearGradient {' \
'#define XRenderCreateLinearGradient			_int_consume

#if !defined(PictOpBlendMinimum)
typedef struct _XLinearGradient {' \
      --replace '} XLinearGradient;
#endif

#if !HAVE_XRENDERCREATERADIALGRADIENT' \
'} XLinearGradient;
#endif
#endif

#if !HAVE_XRENDERCREATERADIALGRADIENT' \
      --replace '#define XRenderCreateRadialGradient			_int_consume

typedef struct _XCircle {' \
'#define XRenderCreateRadialGradient			_int_consume

#if !defined(PictOpBlendMinimum)
typedef struct _XCircle {' \
      --replace '} XRadialGradient;
#endif

#if !HAVE_XRENDERCREATECONICALGRADIENT' \
'} XRadialGradient;
#endif
#endif

#if !HAVE_XRENDERCREATECONICALGRADIENT' \
      --replace '#define XRenderCreateConicalGradient			_int_consume

typedef struct _XConicalGradient {' \
'#define XRenderCreateConicalGradient			_int_consume

#if !defined(PictOpBlendMinimum)
typedef struct _XConicalGradient {' \
      --replace '} XConicalGradient;
#endif


#else /* !CAIRO_HAS_XLIB_XRENDER_SURFACE */' \
'} XConicalGradient;
#endif
#endif


#else /* !CAIRO_HAS_XLIB_XRENDER_SURFACE */'

    # wasm-ld rejects --start-group; skip cairo-script/trace utilities.
    substituteInPlace util/meson.build \
      --replace "if conf.get('CAIRO_HAS_INTERPRETER'" "if false and conf.get('CAIRO_HAS_INTERPRETER'" \
      --replace "if conf.get('CAIRO_HAS_TRACE'" "if false and conf.get('CAIRO_HAS_TRACE'"
  '';

  meta = {
    description = "Cairo 2D graphics library (Xlib backend)";
  };
}
