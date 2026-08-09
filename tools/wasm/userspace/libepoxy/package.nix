{
  pkgs,
  stdenv,
  lib,
  libX11,
  src ? pkgs.fetchFromGitHub {
    owner = "anholt";
    repo = "libepoxy";
    rev = "1.5.10";
    hash = "sha256-gZiyPOW2PeTMILcPiUTqPUGRNlMM5mI1z9563v4SgEs=";
  },
}:

stdenv.mkDerivation {
  pname = "libepoxy";
  version = "1.5.10";
  inherit src;

  depsBuildBuild = [ pkgs.stdenv.cc ];

  nativeBuildInputs = [
    pkgs.meson
    pkgs.ninja
    pkgs.pkg-config
    pkgs.python3
  ];

  buildInputs = [ libX11 ];

  propagatedBuildInputs = [ libX11 ];

  mesonFlags = [
    (lib.mesonOption "default_library" "static")
    (lib.mesonBool "x11" true)
    (lib.mesonOption "glx" "yes")
    (lib.mesonOption "egl" "no")
    (lib.mesonBool "tests" false)
  ];

  mesonBuildType = "release";

  postPatch = ''
    patchShebangs src/*.py
  '';

  meta = {
    description = "libepoxy OpenGL dispatch for wasm32-unknown-linux-musl (static, X11 headers only)";
  };
}
