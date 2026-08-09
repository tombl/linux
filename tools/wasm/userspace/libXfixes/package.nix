{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  libX11,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXfixes-6.0.2.tar.xz";
    hash = "sha256-OfEV1y2cX4ER5GhBZNPWjMH9Ifmyf/JAGwj938D0Cbo=";
  },
}:

stdenv.mkDerivation {
  pname = "libXfixes";
  version = "6.0.2";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [
    xorgproto
    libX11
  ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--enable-malloc0returnsnull";
}
