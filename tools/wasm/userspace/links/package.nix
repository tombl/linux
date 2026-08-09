# Twibright Links — graphical mode via Xlib (TinyX). Runnable guest browser
# while Firefox/NetSurf ports continue.
{
  pkgs,
  stdenv,
  lib,
  openssl,
  zlib,
  libpng,
  libX11,
  libXext,
  libXau,
  libxcb,
  src ? pkgs.fetchurl {
    url = "http://links.twibright.com/download/links-2.30.tar.bz2";
    hash = "sha256-xGMca1oRUnzcPLeHL8I7fyslwrAh1Za+QQ2ttAMV8WY=";
  },
}:

stdenv.mkDerivation {
  pname = "links";
  version = "2.30";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];

  buildInputs = [
    openssl
    zlib
    libpng
    libX11
    libXext
    libXau
    libxcb
  ];

  # Text UI first: clang 22 currently ICEs compiling Links' graphics UI
  # (bfu.c) for wasm32-unknown-linux-musl. Text mode still browses over the
  # virtio-net → WebSocket proxy inside xterm / aurora terminal.
  configureFlags = [
    "--disable-graphics"
    "--without-libevent"
    "--without-librsvg"
    "--without-libjpeg"
    "--without-libtiff"
    "--without-openmp"
    "--with-ssl=${openssl}"
    "--with-zlib=${zlib}"
    "--without-x"
    "--without-gpm"
    "--without-directfb"
    "--without-svgalib"
    "--without-fb"
  ];

  env.NIX_CFLAGS_COMPILE = "-fcommon -g0";
  env.CFLAGS = "-O2 -g0";

  # clang 22 ICEs at -O2 on charsets.c / bfu.c for wasm32-unknown-linux-musl.
  postConfigure = ''
    echo 'charsets.o: CFLAGS += -O0 -fno-strict-aliasing' >> Makefile
    echo 'bfu.o: CFLAGS += -O0 -fno-strict-aliasing' >> Makefile
  '';

  meta = {
    description = "Twibright Links text/graphics web browser";
    homepage = "http://links.twibright.com/";
    license = lib.licenses.gpl2Only;
  };
}
