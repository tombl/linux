{
  pkgs,
  stdenv,
  lib,
  ncurses,
  xorgproto,
  libX11,
  libXext,
  libXaw,
  libXt,
  libXmu,
  libXpm,
  libSM,
  libICE,
  libxcb,
  libXau,
  src ? pkgs.fetchurl {
    urls = [
      "https://invisible-island.net/archives/xterm/xterm-410.tgz"
      "https://invisible-mirror.net/archives/xterm/xterm-410.tgz"
    ];
    hash = "sha256-e6n7swPdPZXQbKJDYNAZBI2E5YItxv5yLNdzab2/Ix8=";
  },
}:

stdenv.mkDerivation {
  pname = "xterm";
  version = "410";
  inherit src;

  patches = [ ../patches/xterm-posix-spawn.patch ];

  nativeBuildInputs = [ pkgs.pkg-config ];

  buildInputs = [
    ncurses
    xorgproto
    libX11
    libXext
    libXaw
    libXt
    libXmu
    libXpm
    libSM
    libICE
    libxcb
    libXau
  ];

  configureFlags = [
    "--disable-freetype"
    "--disable-imake"
    "--disable-luit"
    "--disable-mini-luit"
    "--enable-wide-chars"
    "--enable-256-color"
    "--disable-sixel-graphics"
    "--disable-regis-graphics"
    # fork()-based parent/child pty negotiation cannot work on wasm32-linux.
    "--disable-pty-handshake"
    "--with-app-defaults=$(out)/lib/X11/app-defaults"
  ];

  env = {
    NIX_CFLAGS_COMPILE = "-D_GNU_SOURCE";
    NIX_LDFLAGS = lib.concatStringsSep " " [
      "-L${libXaw}/lib"
      "-L${libXmu}/lib"
      "-L${libXt}/lib"
      "-L${libSM}/lib"
      "-L${libICE}/lib"
      "-L${libXpm}/lib"
      "-L${libXext}/lib"
      "-L${libX11}/lib"
      "-L${libxcb}/lib"
      "-L${libXau}/lib"
      "-L${ncurses}/lib"
      "-lXaw"
      "-lXmu"
      "-lXt"
      "-lSM"
      "-lICE"
      "-lXpm"
      "-lXext"
      "-lX11"
      "-lxcb"
      "-lXau"
      "-lncursesw"
    ];
  };

  enableParallelBuilding = true;
}
