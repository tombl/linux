{
  pkgs,
  stdenv,
  lib,
  src ? pkgs.fetchFromGitHub {
    owner = "ip7z";
    repo = "7zip";
    rev = "26.02";
    hash = "sha256-MmnsCM4guQ5DuWDE5MslI8QIIbkUtZnddVPgAuCRWQU=";
  },
}:

# 7-Zip Alone2 (command-line). pname stays p7zip for the userspace request;
# binaries are installed as 7z/7za (and 7zz).
stdenv.mkDerivation {
  pname = "p7zip";
  version = "26.02";
  inherit src;

  # Clang + non-x86: the un-suffixed cmpl_clang.mak is the portable path.
  makefile = "../../cmpl_clang.mak";

  makeFlags = [
    "CC=${stdenv.cc.targetPrefix}cc"
    "CXX=${stdenv.cc.targetPrefix}c++"
    "DISABLE_RAR=1"
    "USE_ASM="
  ];

  enableParallelBuilding = true;

  preBuild = ''
    cd CPP/7zip/Bundles/Alone2
  '';

  env.NIX_CFLAGS_COMPILE = lib.concatStringsSep " " [
    "-Wno-declaration-after-statement"
    "-Wno-reserved-identifier"
    "-Wno-unused-but-set-variable"
    "-Wno-c++-keyword"
    "-Wno-implicit-void-ptr-cast"
    "-Wno-nrvo"
  ];

  installPhase = ''
    runHook preInstall
    install -Dm755 b/*/7zz $out/bin/7zz
    ln -s 7zz $out/bin/7z
    ln -s 7zz $out/bin/7za
    runHook postInstall
  '';
}
