{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libpthread-stubs-0.5.tar.xz";
    hash = "sha256-WdpWbezOunwqeXCkoDtI2ZBfEmL/lEEKZJIk4z0kQrw=";
  },
}:

# Empty pthread stubs for pkg-config completeness; musl already provides pthreads.
stdenv.mkDerivation {
  pname = "libpthread-stubs";
  version = "0.5";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}
