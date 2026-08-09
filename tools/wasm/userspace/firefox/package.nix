# Firefox / Gecko for wasm32-unknown-linux-musl + TinyX.
#
# Platform limits: no fork/vfork/mmap. Strategy:
#   1) SpiderMonkey JS shell (--enable-project=js) to prove mach + Rust target
#   2) Full browser with single-process + GTK stack (follow-on)
#
# Host mach must use Python <=3.13 (3.14 dropped ast.Constant.s). Nix sandbox
# has no pip, so MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none|system.
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

let
  # 3.14 breaks mach's AST walker; nixpkgs uses 3.13 for Firefox <143.
  python = pkgs.python311;
in
stdenv.mkDerivation {
  pname = "firefox-js";
  version = "128.14.0esr";
  inherit src;

  nativeBuildInputs = [
    python
    pkgs.perl
    pkgs.pkg-config
    pkgs.m4
    pkgs.which
    pkgs.unzip
    pkgs.zip
    pkgs.llvmPackages.bintools
    pkgs.autoconf
    pkgs.nodejs
    pkgs.rust-cbindgen
    rust-toolchain.rustc
    rust-toolchain.cargo
  ];

  buildInputs = [
    zlib
    openssl
    curl
  ];

  dontConfigure = true;

  postPatch = ''
    patchShebangs mach build
  '';

  buildPhase = ''
    runHook preBuild

    export MOZBUILD_STATE_PATH="$TMPDIR/mozbuild"
    export MOZ_OBJDIR="$(pwd)/obj-wasm-js"
    export MOZ_NOSPAM=1
    # Optional pypi wheels (glean/psutil/zstd) cannot be fetched in the sandbox.
    export MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none
    mkdir -p "$MOZBUILD_STATE_PATH"

    cat > .mozconfig <<'EOF'
ac_add_options --enable-project=js
ac_add_options --target=wasm32-unknown-linux-musl
ac_add_options --host=x86_64-pc-linux-gnu
ac_add_options --disable-jemalloc
ac_add_options --disable-tests
ac_add_options --disable-bootstrap
ac_add_options --enable-release
ac_add_options --disable-debug
ac_add_options --disable-jit
mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-wasm-js
EOF

    export HOST_CC=${pkgs.stdenv.cc}/bin/cc
    export HOST_CXX=${pkgs.stdenv.cc}/bin/c++
    export PATH="${rust-toolchain.rustc}/bin:${rust-toolchain.cargo}/bin:$PATH"
    export RUSTC=${rust-toolchain.rustc}/bin/rustc
    export CARGO=${rust-toolchain.cargo}/bin/cargo
    export RUST_TARGET_PATH="${rust-toolchain.targetSpecDir}''${RUST_TARGET_PATH:+:$RUST_TARGET_PATH}"

    echo "=== firefox mach configure (python ${python.pythonVersion}) ==="
    ${python}/bin/python3 ./mach configure
    echo "=== firefox mach build ==="
    ${python}/bin/python3 ./mach build -j"$NIX_BUILD_CORES"
    echo "=== firefox mach build done ==="
    ls -la obj-wasm-js/dist/bin/ || true

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    if [ -x obj-wasm-js/dist/bin/js ]; then
      cp -a obj-wasm-js/dist/bin/js $out/bin/js
    else
      echo "spidermonkey js shell missing; obj tree:" >&2
      find obj-wasm-js -maxdepth 3 -type f 2>/dev/null | head -80 >&2 || true
      exit 1
    fi
    runHook postInstall
  '';

  meta = {
    description = "SpiderMonkey JS shell from Firefox 128 ESR (wasm32-linux-musl experiment)";
    license = lib.licenses.mpl20;
    broken = true;
  };
}
