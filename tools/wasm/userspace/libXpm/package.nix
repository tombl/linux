{
  pkgs,
  stdenv,
  xorgproto,
  libX11,
  libXext,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXpm-3.5.19.tar.xz";
    hash = "sha256-rTV21okiGjncco8ODcAsp7tqDXJMmnf9G/oemvg76QA=";
  },
}:

stdenv.mkDerivation {
  pname = "libXpm";
  version = "3.5.19";
  inherit src;

  nativeBuildInputs = [
    pkgs.pkg-config
    # cxpm.po / message catalogs need xgettext during `make all`.
    pkgs.gettext
  ];
  buildInputs = [
    xorgproto
    libX11
    libXext
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-open-zfile"
  ];
}
