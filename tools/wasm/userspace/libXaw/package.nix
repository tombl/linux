{
  pkgs,
  stdenv,
  xorgproto,
  libX11,
  libXext,
  libXt,
  libXmu,
  libXpm,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXaw-1.0.16.tar.xz";
    hash = "sha256-cx1XK1THCPgeGXpq+oAWkY4uBt/TAl4GbKZCpbjDnI8=";
  },
}:

stdenv.mkDerivation {
  pname = "libXaw";
  version = "1.0.16";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
    libXext
    libXt
    libXmu
    libXpm
  ];
  propagatedBuildInputs = [
    xorgproto
    libX11
    libXext
    libXt
    libXmu
    libXpm
  ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-specs"
  ];

  # Static-only builds still leave install-exec-hook .so compatibility links,
  # and never install an unsuffixed libXaw.a (only libXaw6/7.a).
  postInstall = ''
    find "$out/lib" -maxdepth 1 \( -type l -o -type f \) -name 'libXaw*.so*' -delete || true
    if [ -f "$out/lib/libXaw7.a" ] && [ ! -e "$out/lib/libXaw.a" ]; then
      ln -s libXaw7.a "$out/lib/libXaw.a"
    fi
  '';
}
