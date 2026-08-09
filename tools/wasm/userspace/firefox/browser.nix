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
    ./patches/0012-wasm-no-midir-alsa.patch
    ./patches/0013-wasm-nspr-linux-cpu.patch
    ./patches/0014-wasm-time-crate-linux.patch
    ./patches/0015-wasm-chrono-linux.patch
    ./patches/0016-wasm-linux-raw-sys-x86.patch
    ./patches/0017-wasm-nspr-no-fork.patch
    ./patches/0018-wasm-rustix-ioctl-consts.patch
    ./patches/0019-wasm-zeitstempel-timespec.patch
    ./patches/0020-wasm-webrender-budgettype-count.patch
    ./patches/0021-wasm-neqo-bindgen-c-mode.patch
    ./patches/0022-wasm-wgpu-types-no-web-sys-linux.patch
    ./patches/0023-wasm-wgpu-empty-backend.patch
    ./patches/0024-wasm-bindgen-linkage-abi.patch
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
# Refresh vendored crate checksums after linux/wasm sys.rs patches.
for crate in ("time-0.1.45", "chrono", "linux-raw-sys", "rustix", "zeitstempel", "wgpu-types", "wgpu-core", "bindgen"):
    root = Path("third_party/rust") / crate
    checksum_path = root / ".cargo-checksum.json"
    if not checksum_path.is_file():
        continue
    data = json.loads(checksum_path.read_text())
    files = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == ".cargo-checksum.json":
            continue
        rel = path.relative_to(root).as_posix()
        files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    data["files"] = files
    checksum_path.write_text(json.dumps(data))
    print(f"updated checksums for {len(files)} {crate} files")
PY
    # Stub HTTP/3 (neqo) — NSS bindgen for neqo-crypto is incomplete on wasm32.
    # HTTPS continues via HTTP/1.1 and HTTP/2.
    cp ${./shim/neqo_glue_Cargo.toml} netwerk/socket/neqo_glue/Cargo.toml
    cp ${./shim/neqo_glue_stub.rs} netwerk/socket/neqo_glue/src/lib.rs
    ${python}/bin/python3 ${./shim/patch-neqo-glue-lock.py}
    # gecko-profiler bindgen needs MOZ_GECKO_PROFILER types absent on wasm32.
    cp ${./shim/gecko_profiler_stub_Cargo.toml} tools/profiler/rust-api/Cargo.toml
    cp ${./shim/gecko_profiler_stub_build.rs} tools/profiler/rust-api/build.rs
    cp ${./shim/gecko_profiler_stub_lib.rs} tools/profiler/rust-api/src/lib.rs
    ${python}/bin/python3 ${./shim/patch-gecko-profiler-lock.py}
    # ohttp NSS bindgen is incomplete on wasm32; rust-hpke deps are not vendored.
    cp ${./shim/oblivious_http_Cargo.toml} netwerk/protocol/http/oblivious_http/Cargo.toml
    cp ${./shim/oblivious_http_stub.rs} netwerk/protocol/http/oblivious_http/src/lib.rs
    ${python}/bin/python3 ${./shim/patch-oblivious-http-lock.py}
    # WebAuthn pulls authenticator-rs -> nss-gk-api; NSS bindgen is incomplete
    # on wasm32. example.com does not need WebAuthn.
    cp ${./shim/authrs_bridge_Cargo.toml} dom/webauthn/authrs_bridge/Cargo.toml
    cp ${./shim/authrs_bridge_stub.rs} dom/webauthn/authrs_bridge/src/lib.rs
    rm -f dom/webauthn/authrs_bridge/src/about_webauthn_controller.rs \
          dom/webauthn/authrs_bridge/src/test_token.rs
    ${python}/bin/python3 ${./shim/patch-authrs-bridge-lock.py}
    # fog_control still depends on ohttp (NSS bindgen). Fail closed.
    rm -rf third_party/rust/ohttp
    mkdir -p third_party/rust/ohttp/src
    cp ${./shim/ohttp_stub_Cargo.toml} third_party/rust/ohttp/Cargo.toml
    cp ${./shim/ohttp_stub_lib.rs} third_party/rust/ohttp/src/lib.rs
    ${python}/bin/python3 ${./shim/patch-ohttp-lock.py}
    ${python}/bin/python3 - <<'PY'
import hashlib, json
from pathlib import Path
root = Path("third_party/rust/ohttp")
files = {}
for path in sorted(root.rglob("*")):
    if not path.is_file() or path.name == ".cargo-checksum.json":
        continue
    rel = path.relative_to(root).as_posix()
    files[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
(root / ".cargo-checksum.json").write_text(
    json.dumps({"files": files, "package": "850ce328ec7e4dc1a9446c56aef700d21d914268c8529b96017a2bf10f74b70f"})
)
print(f"updated checksums for {len(files)} ohttp stub files")
PY
    # Stub Cargo.toml edits orphan lock entries; prune so --frozen stays happy.
    ${python}/bin/python3 ${./shim/prune-cargo-lock.py}
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
ac_add_options --disable-gecko-profiler
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
    # Prefer rustix libc backend on wasm32-linux (no linux_raw inline asm).
    export RUSTFLAGS="--cfg rustix_use_libc ''${RUSTFLAGS:-}"
    # Host build-scripts (webrender/glslopt) link libstdc++ but the sandbox has
    # no /lib/x86_64-linux-gnu; put nix's libstdc++ on the loader path.
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ]}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

    # rust-bindgen uses libclang, which does not see nix cc-wrapper's injected
    # --target/sysroot/libcxx flags. Without these, Stylo's gecko structs.rs
    # emits opaque `{ _address: u8 }` types and omits Gecko_* functions.
    _bindgen_sysroot="$(cat "$NIX_CC/nix-support/orig-libc")"
    _bindgen_libcxx="$(cat "$NIX_CC/nix-support/libcxx-cxxflags")"
    _bindgen_resource="$($CXX -print-resource-dir)"
    # -fvisibility=default: wasm builds use -fvisibility=hidden; libclang then
    # reports Gecko_*/Servo_* decls as Hidden and bindgen drops them all.
    export BINDGEN_CFLAGS="--target=wasm32-unknown-linux-musl --sysroot=''${_bindgen_sysroot} ''${_bindgen_libcxx} -resource-dir=''${_bindgen_resource} -fvisibility=default"
    echo "BINDGEN_CFLAGS=$BINDGEN_CFLAGS"

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
