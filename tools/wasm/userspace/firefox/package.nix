# Firefox / Gecko for wasm32-unknown-linux-musl + TinyX.
#
# Platform limits: no fork/vfork/mmap. Strategy:
#   1) SpiderMonkey JS shell (--enable-project=js) to prove mach + Rust target
#   2) Full browser with single-process + GTK stack (follow-on)
#
# Host mach must use Python <=3.13 (3.14 dropped ast.Constant.s). Nix sandbox
# has no pip, so MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=none|system.
#
# Vendored crates.io libc 0.2.153 has no ILP32 wasm32+musl module; replace it
# with the tombl/libc fork (same ABI as wasmpkgs rust std) and spoof the
# package version so Cargo.lock stays satisfied.
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
  libc-src ? pkgs.fetchFromGitHub {
    owner = "tombl";
    repo = "libc";
    rev = "fc8cc62b93f1c374e944d7880e71aa16434b7c6e";
    hash = "sha256-s2qZCiyVgLGZh6x5E4pmVT3mnoEF8q4M3bWdXVqGclQ=";
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
  ];

  postPatch = ''
    patchShebangs mach build

    # Prefer existing WASI memalign paths over Linux mmap in GC / typed arrays.
    ${python}/bin/python3 ${./expand-wasi-guards.py} .

    # Swap in the wasm32-unknown-linux-musl libc bindings (ILP32 musl).
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
    if not path.is_file():
        continue
    if path.name == ".cargo-checksum.json":
        continue
    rel = path.relative_to(root).as_posix()
    files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
# Keep the crates.io package checksum from Cargo.lock so cargo accepts
# the vendored replacement (file hashes are local-only metadata).
package = "9c198f91728a82281a64e1f4f9eeb25d82cb32a5de251c6bd1b5154d63a8e7bd"
(root / ".cargo-checksum.json").write_text(
    json.dumps({"files": files, "package": package})
)
print(f"wrote checksums for {len(files)} libc files")
PY
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
# Platform has no shared libraries / dlopen; link mozjs statically into js.
ac_add_options --disable-shared-js
ac_add_options --disable-export-js
# --disable-release sets DEVELOPER_OPTIONS, which turns off Rust -Clto
# (wasm sysroot rlibs have no .llvmbc for crate LTO).
ac_add_options --disable-release
ac_add_options --disable-debug
ac_add_options --disable-jit
ac_add_options --disable-lto
# musl ILP32: uintptr_t is unsigned long while PRIxPTR may be "x".
ac_add_options --disable-warnings-as-errors
mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-wasm-js
EOF

    export HOST_CC=${pkgs.stdenv.cc}/bin/cc
    export HOST_CXX=${pkgs.stdenv.cc}/bin/c++
    export PATH="${rust-toolchain.rustc}/bin:${rust-toolchain.cargo}/bin:$PATH"
    export RUSTC=${rust-toolchain.rustc}/bin/rustc
    export CARGO=${rust-toolchain.cargo}/bin/cargo
    export RUST_TARGET_PATH="${rust-toolchain.targetSpecDir}''${RUST_TARGET_PATH:+:$RUST_TARGET_PATH}"

    # Firefox-local anonymous mmap shim (musl hides sys/mman.h on __wasm__).
    SHIM="$TMPDIR/firefox-mmap-shim"
    mkdir -p "$SHIM/sys"
    cp ${./shim/sys/mman.h} "$SHIM/sys/mman.h"
    cp ${./shim/mmap-shim.c} "$SHIM/mmap-shim.c"
    $CC -c "$SHIM/mmap-shim.c" -I"$SHIM" -o "$SHIM/mmap-shim.o"
    export CFLAGS="-I$SHIM ''${CFLAGS:-}"
    export CXXFLAGS="-I$SHIM ''${CXXFLAGS:-}"
    export LIBS="$SHIM/mmap-shim.o ''${LIBS:-}"
    # Drop any ELF rpath flags that still leak into the wasm-ld command line.
    export NIX_LDFLAGS="$(printf %s "''${NIX_LDFLAGS-}" | sed -E 's/(^| )-rpath( |=)[^ ]+//g; s/(^| )-rpath-link( |=)[^ ]+//g')"
    export LDFLAGS="$(printf %s "''${LDFLAGS-}" | sed -E 's/-Wl,-rpath[^ ]*//g; s/-Wl,--rpath-link[^ ]*//g')"

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
    mkdir -p $out/bin $out/share/applications
    if [ -x obj-wasm-js/dist/bin/js ]; then
      cp -a obj-wasm-js/dist/bin/js $out/bin/js
    elif [ -x obj-wasm-browser/dist/bin/firefox ]; then
      cp -a obj-wasm-browser/dist/bin/firefox $out/bin/firefox
    else
      echo "firefox/js binary missing; obj tree:" >&2
      find obj-wasm-* -maxdepth 3 -type f 2>/dev/null | head -80 >&2 || true
      exit 1
    fi
    # Prefer a real firefox binary on PATH for aurora-wm Browser discovery.
    if [ -x $out/bin/firefox ]; then
      :
    elif [ -x obj-wasm-browser/dist/bin/firefox ]; then
      cp -a obj-wasm-browser/dist/bin/firefox $out/bin/firefox
    fi
    if [ -x $out/bin/firefox ]; then
      cat > $out/share/applications/firefox.desktop <<'DESKTOP'
[Desktop Entry]
Name=Firefox
Comment=Web Browser
Exec=firefox %u
Terminal=false
Type=Application
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
DESKTOP
    fi
    runHook postInstall
  '';

  meta = {
    description = "Firefox / SpiderMonkey for wasm32-linux-musl (TinyX experiment)";
    license = lib.licenses.mpl20;
    # Cleared once `bin/js` or `bin/firefox` installs cleanly.
    broken = true;
  };
}
