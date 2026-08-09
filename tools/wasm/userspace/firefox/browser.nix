# Full Firefox browser for wasm32-unknown-linux-musl + TinyX/GTK3.
# Builds on the SpiderMonkey packaging (same patches/shims/rust libc swap).
{
  pkgs,
  stdenv,
  lib,
  zlib,
  openssl,
  curl,
  rust-toolchain,
  gtk3,
  glib,
  cairo,
  pango,
  gdk-pixbuf,
  atk,
  libepoxy,
  freetype,
  fontconfig,
  harfbuzz,
  fribidi,
  pixman,
  libpng,
  expat,
  pcre2,
  libffi,
  libX11,
  libXext,
  libXrender,
  libXfixes,
  libXdamage,
  libXcomposite,
  libXcursor,
  libXi,
  libXrandr,
  libXinerama,
  libICE,
  libSM,
  libxcb,
  xorgproto,
  src ? pkgs.fetchurl {
    url = "https://archive.mozilla.org/pub/firefox/releases/128.14.0esr/source/firefox-128.14.0esr.source.tar.xz";
    hash = "sha256-k7nvYin0HLIv8Qm5W79hp4OVoP5LhwGS7soilHywmlM=";
  },
  libc-src ? pkgs.fetchFromGitHub {
    owner = "tombl";
    repo = "libc";
    rev = "fc8cc62b93f1c374e944d7880e71aa16434b7c6e";
    hash = "sha256-s2qZCiyVgLGZh6x5E4pmVT3mnoEF8q4M3bWdXVqGclQ=";
  },
}:

let
  python = pkgs.python311;
in
stdenv.mkDerivation {
  pname = "firefox";
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
    gtk3
    glib
    cairo
    pango
    gdk-pixbuf
    atk
    libepoxy
    freetype
    fontconfig
    harfbuzz
    fribidi
    pixman
    libpng
    expat
    pcre2
    libffi
    libX11
    libXext
    libXrender
    libXfixes
    libXdamage
    libXcomposite
    libXcursor
    libXi
    libXrandr
    libXinerama
    libICE
    libSM
    libxcb
    xorgproto
  ];

  dontConfigure = true;
  dontUpdateAutotoolsGnuConfigScripts = true;

  patches = [
    ./patches/0001-rust-target-list-wasm-musl.patch
    ./patches/0002-icu-no-mmap-wasm.patch
    ./patches/0003-icu-data-asm-wasm.patch
    ./patches/0004-wasm-no-mmap-like-wasi.patch
    ./patches/0005-wasm-execmem-and-ilp32.patch
    ./patches/0006-wasm-ilp32-nofork.patch
    ./patches/0007-wasm-sharedarray-shell.patch
    ./patches/0008-wasm-prixptr-format.patch
    ./patches/0009-wasm-no-rpath-link.patch
    ./patches/0010-wasm-no-fix-link-paths.patch
    ./patches/0011-wasm-linux-target-cpu.patch
  ];

  postPatch = ''
    patchShebangs mach build
    ${python}/bin/python3 ${./expand-wasi-guards.py} .
    rm -rf third_party/rust/libc
    cp -a ${libc-src} third_party/rust/libc
    chmod -R u+w third_party/rust/libc
    sed -i 's/^version = "0\.2\.[0-9]*"/version = "0.2.153"/' third_party/rust/libc/Cargo.toml
    ${python}/bin/python3 - <<'PY'
import hashlib, json
from pathlib import Path
root = Path("third_party/rust/libc")
files = {}
for path in sorted(root.rglob("*")):
    if not path.is_file() or path.name == ".cargo-checksum.json":
        continue
    rel = path.relative_to(root).as_posix()
    files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
package = "9c198f91728a82281a64e1f4f9eeb25d82cb32a5de251c6bd1b5154d63a8e7bd"
(root / ".cargo-checksum.json").write_text(json.dumps({"files": files, "package": package}))
print(f"wrote checksums for {len(files)} libc files")
PY
  '';

  buildPhase = ''
    runHook preBuild

    export MOZBUILD_STATE_PATH="$TMPDIR/mozbuild"
    export MOZ_OBJDIR="$(pwd)/obj-wasm-browser"
    export MOZ_NOSPAM=1
    export MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none
    mkdir -p "$MOZBUILD_STATE_PATH"

    cat > .mozconfig <<'EOF'
ac_add_options --enable-application=browser
ac_add_options --target=wasm32-unknown-linux-musl
ac_add_options --host=x86_64-pc-linux-gnu
ac_add_options --enable-default-toolkit=cairo-gtk3-x11-only
ac_add_options --disable-jemalloc
ac_add_options --disable-tests
ac_add_options --disable-bootstrap
ac_add_options --disable-forkserver
ac_add_options --disable-sandbox
ac_add_options --disable-crashreporter
ac_add_options --disable-updater
ac_add_options --disable-dbus
ac_add_options --disable-necko-wifi
ac_add_options --disable-webrtc
# Default audio backend is pulseaudio on Linux; disable all cubeb backends.
ac_add_options --disable-audio-backends
ac_add_options --without-wasm-sandboxed-libraries
ac_add_options --disable-release
ac_add_options --disable-debug
ac_add_options --disable-jit
ac_add_options --disable-lto
ac_add_options --disable-warnings-as-errors
mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-wasm-browser
EOF

    export HOST_CC=${pkgs.stdenv.cc}/bin/cc
    export HOST_CXX=${pkgs.stdenv.cc}/bin/c++
    export PATH="${rust-toolchain.rustc}/bin:${rust-toolchain.cargo}/bin:$PATH"
    export RUSTC=${rust-toolchain.rustc}/bin/rustc
    export CARGO=${rust-toolchain.cargo}/bin/cargo
    export RUST_TARGET_PATH="${rust-toolchain.targetSpecDir}''${RUST_TARGET_PATH:+:$RUST_TARGET_PATH}"

    SHIM="$TMPDIR/firefox-mmap-shim"
    mkdir -p "$SHIM/sys"
    cp ${./shim/sys/mman.h} "$SHIM/sys/mman.h"
    cp ${./shim/mmap-shim.c} "$SHIM/mmap-shim.c"
    cp ${./shim/unwind-stubs.c} "$SHIM/unwind-stubs.c"
    $CC -c "$SHIM/mmap-shim.c" -I"$SHIM" -o "$SHIM/mmap-shim.o"
    $CC -c "$SHIM/unwind-stubs.c" -o "$SHIM/unwind-stubs.o"
    export CFLAGS="-I$SHIM ''${CFLAGS:-}"
    export CXXFLAGS="-I$SHIM ''${CXXFLAGS:-}"
    export LIBS="$SHIM/mmap-shim.o $SHIM/unwind-stubs.o ''${LIBS:-}"
    export NIX_LDFLAGS="$(printf %s "''${NIX_LDFLAGS-}" | sed -E 's/(^| )-rpath( |=)[^ ]+//g; s/(^| )-rpath-link( |=)[^ ]+//g')"
    export LDFLAGS="$(printf %s "''${LDFLAGS-}" | sed -E 's/-Wl,-rpath[^ ]*//g; s/-Wl,--rpath-link[^ ]*//g')"

    echo "=== firefox browser mach configure ==="
    ${python}/bin/python3 ./mach configure
    echo "=== firefox browser mach build ==="
    ${python}/bin/python3 ./mach build -j"$NIX_BUILD_CORES"
    echo "=== firefox browser mach build done ==="
    ls -la obj-wasm-browser/dist/bin/ || true

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin $out/share/applications
    if [ -x obj-wasm-browser/dist/bin/firefox ]; then
      cp -a obj-wasm-browser/dist/bin/firefox $out/bin/firefox
    else
      echo "firefox binary missing; obj tree:" >&2
      find obj-wasm-browser -maxdepth 4 -type f 2>/dev/null | head -120 >&2 || true
      exit 1
    fi
    cp ${./firefox.desktop} $out/share/applications/firefox.desktop
    runHook postInstall
  '';

  passthru.apk = {
    name = "firefox";
    version = "128.14.0-r0";
  };

  meta = {
    description = "Firefox browser for wasm32-linux-musl + TinyX";
    license = lib.licenses.mpl20;
    mainProgram = "firefox";
    broken = true;
  };
}
