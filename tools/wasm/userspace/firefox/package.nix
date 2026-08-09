# Firefox / Gecko for wasm32-unknown-linux-musl + TinyX.
#
# Full browser build is blocked on: GTK3 stack, multiprocess IPC without fork,
# mmap-heavy allocators, and a custom Rust target. This derivation:
#   1) Fetches Firefox 128 ESR sources
#   2) Attempts `./mach configure` for --enable-project=js (SpiderMonkey shell)
#      as the first Gecko milestone (no GTK)
#   3) Stays `meta.broken` until configure succeeds end-to-end
#
# Runnable networking is already available via busybox wget / curl in gui-rootfs.
{
  pkgs,
  stdenv,
  lib,
  zlib,
  openssl,
  curl,
  rust-toolchain,
  src ? pkgs.fetchurl {
    url = "https://archive.mozilla.org/pub/firefox/releases/128.14.0esr/source/firefox-128.14.0esr.source.tar.xz";
    hash = "sha256-k7nvYin0HLIv8Qm5W79hp4OVoP5LhwGS7soilHywmlM=";
  },
}:

stdenv.mkDerivation {
  pname = "firefox-js";
  version = "128.14.0esr";
  inherit src;

  nativeBuildInputs = [
    pkgs.python3
    pkgs.perl
    pkgs.pkg-config
    pkgs.m4
    pkgs.which
    pkgs.unzip
    pkgs.zip
    pkgs.llvmPackages.bintools
    rust-toolchain.rustc
    rust-toolchain.cargo
  ];

  buildInputs = [
    zlib
    openssl
    curl
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild

    export MOZBUILD_STATE_PATH=$TMPDIR/mozbuild
    mkdir -p "$MOZBUILD_STATE_PATH"

    # SpiderMonkey shell first — no GTK. Still needs Rust for this target.
    cat > .mozconfig <<EOF
ac_add_options --enable-project=js
ac_add_options --target=wasm32-unknown-linux-musl
ac_add_options --disable-jemalloc
ac_add_options --disable-tests
ac_add_options --disable-bootstrap
ac_add_options --without-wasm-sandboxed-libraries
ac_add_options --enable-release
ac_add_options --disable-debug
mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-wasm-js
EOF

    export HOST_CC=${pkgs.stdenv.cc}/bin/cc
    export HOST_CXX=${pkgs.stdenv.cc}/bin/c++
    export CC=$CC
    export CXX=$CXX
    export AR=$AR
    export RANLIB=$RANLIB
    export PATH="${rust-toolchain.rustc}/bin:${rust-toolchain.cargo}/bin:$PATH"
    export RUSTC=${rust-toolchain.rustc}/bin/rustc
    export CARGO=${rust-toolchain.cargo}/bin/cargo

    ./mach configure
    ./mach build -j$NIX_BUILD_CORES

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    if [ -x obj-wasm-js/dist/bin/js ]; then
      cp -a obj-wasm-js/dist/bin/js $out/bin/js
    else
      echo "spidermonkey js shell missing" >&2
      exit 1
    fi
    runHook postInstall
  '';

  meta = {
    description = "SpiderMonkey JS shell from Firefox 128 ESR (wasm32-linux-musl experiment)";
    license = lib.licenses.mpl20;
    # Clear once mach configure/build completes for the JS shell.
    broken = true;
  };
}
