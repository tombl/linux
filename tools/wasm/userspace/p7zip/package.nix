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
      # isystem only — clang's cc-wrapper treats every compile as C++ for
      # include purposes, so -stdlib=libc++ would break Alone2's -Werror C build.
      "-isystem ${sysroot}/include/${multiarch}/c++/v1 -isystem ${sysroot}/include/c++/v1";
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
    # musl's CPU_ISSET casts away const; Alone2 builds with -Werror -Weverything.
    "CFLAGS_WARN=-Wno-cast-qual -Wno-reserved-identifier -Wno-unused-but-set-variable -Wno-c++-keyword -Wno-implicit-void-ptr-cast -Wno-nrvo -Wno-declaration-after-statement"
    # wasm-ld does not understand GNU -z noexecstack.
    "LDFLAGS_STATIC_2="
  ];

  enableParallelBuilding = true;

  preBuild = ''
    cd CPP/7zip/Bundles/Alone2
    # libc++abi references libunwind; wasm sysroot has no unwinder yet.
    $CC -c ${./unwind-stubs.c} -o "$NIX_BUILD_TOP/unwind-stubs.o"
    export NIX_CFLAGS_LINK="$NIX_CFLAGS_LINK $NIX_BUILD_TOP/unwind-stubs.o"
  '';

  env = {
    NIX_CXXSTDLIB_COMPILE = libcxxCompile;
    NIX_CXXSTDLIB_LINK = "-stdlib=libc++ -lc++ -lc++abi";
    NIX_CFLAGS_COMPILE = lib.concatStringsSep " " [
      "-Wno-declaration-after-statement"
      "-Wno-reserved-identifier"
      "-Wno-unused-but-set-variable"
      "-Wno-c++-keyword"
      "-Wno-implicit-void-ptr-cast"
      "-Wno-nrvo"
    ];
  };

  installPhase = ''
    runHook preInstall
    install -Dm755 b/*/7zz $out/bin/7zz
    ln -s 7zz $out/bin/7z
    ln -s 7zz $out/bin/7za
    runHook postInstall
  '';
}
