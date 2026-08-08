{
  pkgs,
  stdenv,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/proto/xorgproto-2024.1.tar.xz";
    hash = "sha256-NyIl/UCBW4QjVH9diQxd68cuiLkQiPv7ExWMIElcy1k=";
  },
}:

# Headers/pkg-config only. Prefer the autotools tarball over meson's 2025.1 so
# the wasm stdenv's ordinary configurePhase applies without a meson cross file.
stdenv.mkDerivation {
  pname = "xorgproto";
  version = "2024.1";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];

  # No binaries; keep the install layout for pkg-config consumers.
}
