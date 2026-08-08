{
  pkgs,
  stdenv,
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
    "--with-app-defaults=$(out)/lib/X11/app-defaults"
  ];

  # Force the static Athena widget stack onto the final link.
  env = {
    NIX_CFLAGS_COMPILE = "-D_GNU_SOURCE";
    NIX_LDFLAGS = "-lXaw -lXmu -lXt -lSM -lICE -lXpm -lXext -lX11 -lncursesw";
  };

  enableParallelBuilding = true;
}
