{
  pkgs,
  stdenv,
  lib,
  src ? pkgs.fetchurl {
    url = "https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz";
    hash = "sha256-GxzeWyNdQEeekb4vDoijCeMhTIq0cOyKJ0TYKlqeoFw=";
  },
}:

stdenv.mkDerivation {
  pname = "fribidi";
  version = "1.0.16";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
    "--disable-binaries"
    "--disable-docs"
  ]
  ++ lib.optional (stdenv.hostPlatform != stdenv.buildPlatform) "--host=${stdenv.hostPlatform.config}";
}
