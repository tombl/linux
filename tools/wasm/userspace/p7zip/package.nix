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
let
  # Belt-and-suspenders if the wasm cc-wrapper lacks libcxx-* flags:
  # sysroot layout is include/<multiarch>/c++/v1 + include/c++/v1.
  sysroot = stdenv.cc.libc or null;
  multiarch = "wasm32-linux-musl";
  libcxxCompile =
    if sysroot == null then
      ""
    else
      "-stdlib=libc++ -isystem ${sysroot}/include/${multiarch}/c++/v1 -isystem ${sysroot}/include/c++/v1";
in
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

  env = {
    NIX_CFLAGS_COMPILE = lib.concatStringsSep " " [
      libcxxCompile
      "-Wno-declaration-after-statement"
      "-Wno-reserved-identifier"
      "-Wno-unused-but-set-variable"
      "-Wno-c++-keyword"
      "-Wno-implicit-void-ptr-cast"
      "-Wno-nrvo"
    ];
    NIX_CFLAGS_LINK = "-stdlib=libc++ -lc++ -lc++abi";
  };

  installPhase = ''
    runHook preInstall
    install -Dm755 b/*/7zz $out/bin/7zz
    ln -s 7zz $out/bin/7z
    ln -s 7zz $out/bin/7za
    runHook postInstall
  '';
}
