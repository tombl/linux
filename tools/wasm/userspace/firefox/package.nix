# Firefox (Gecko) cross-build for wasm32-unknown-linux-musl + TinyX/X11.
#
# Scaffolding only: a full Firefox port needs extensive no-fork / toolkit / IPC
# work. Marked broken so default GUI builds do not attempt it. Enable and point
# `src` at an ESR tarball when continuing the port.
{
  pkgs,
  stdenv,
  lib,
  libX11,
  libXext,
  libXt,
  zlib,
  openssl,
  curl,
}:

stdenv.mkDerivation {
  pname = "firefox";
  version = "128.0.3esr-wip";

  # Placeholder until the ESR fetch hash is pinned for the real port.
  src = pkgs.emptyFile;

  nativeBuildInputs = [
    pkgs.python3
    pkgs.perl
    pkgs.pkg-config
    pkgs.rustc
    pkgs.cargo
    pkgs.m4
    pkgs.which
    pkgs.unzip
    pkgs.zip
  ];

  buildInputs = [
    libX11
    libXext
    libXt
    zlib
    openssl
    curl
  ];

  dontConfigure = true;

  buildPhase = ''
    echo "firefox wasm port is not enabled yet (see tools/wasm/userspace/firefox/package.nix)" >&2
    exit 1
  '';

  meta = {
    description = "Firefox browser for wasm32-unknown-linux-musl (experimental)";
    license = lib.licenses.mpl20;
    broken = true;
  };
}
