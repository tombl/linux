{
  pkgs,
  stdenv,
  lib,
  xorgproto,
  xtrans,
  libXext,
  libXdmcp,
  libXau,
  libXfont,
  libfontenc,
  zlib,
  src ? pkgs.fetchFromGitHub {
    owner = "tinycorelinux";
    repo = "tinyx";
    rev = "feab72ca891bc04b18763763e15ee4e532369cdf";
    hash = "sha256-e8gzKouOtay3u5y6FcBf5YVt9hgfn7p1FDGbgpM3tZ0=";
  },
}:

stdenv.mkDerivation {
  pname = "tinyx";
  version = "1.3-unstable-2024-11-13";
  inherit src;

  patches = [
    ../patches/tinyx-no-mmap-fb.patch
    ../patches/tinyx-no-vt.patch
    ../patches/tinyx-no-fork.patch
    ../patches/tinyx-xtestproto.patch
    ../patches/tinyx-no-mmap-kmap.patch
  ];

  nativeBuildInputs = [
    pkgs.autoreconfHook
    pkgs.pkg-config
    pkgs.flex
    pkgs.bison
    pkgs.libtool
    pkgs.util-macros
    # Provides share/aclocal/xtrans.m4 (XTRANS_CONNECTION_FLAGS).
    xtrans
  ];

  buildInputs = [
    xorgproto
    xtrans
    # Client headers (XShm.h, shape.h, …) that TinyX still includes directly.
    libXext
    # osdep.h includes <X11/Xdmcp.h> for ARRAY8Ptr even with --disable-xdmcp.
    libXdmcp
    # access.c includes <X11/Xauth.h>.
    libXau
    libXfont
    libfontenc
    zlib
  ];

  # Only the fbdev kdrive server is useful in the wasm guest.
  configureFlags = [
    "--enable-kdrive"
    "--enable-xfbdev"
    "--disable-xvesa"
    "--disable-xdmcp"
    "--disable-xdm-auth-1"
    "--disable-install-setuid"
    # Server sources include the libXext client header <X11/extensions/dpms.h>;
    # we only ship xorgproto's dpmsproto.h, so leave DPMS out.
    "--disable-dpms"
    "--with-fontdir=/share/fonts/X11"
    "--with-default-font-path=/share/fonts/X11/misc"
  ];

  # Reinforcing the platform site file: TinyX probes mmap for Xvfb paths.
  preConfigure = ''
    export ac_cv_func_mmap=no
    export ac_cv_func_mmap_fixed_mapped=no
  '';

  # TinyX still ships K&R definitions; the wasm stdenv defaults to gnu23.
  # servermd.h has no wasm32 section, so force the usual 32-bit LE glyph pad.
  # Extension *.c files use INITARGS as a macro (normally only defined in
  # miinitext.c); define it globally so `FooExtensionInit(INITARGS)` parses.
  env = {
    NIX_CFLAGS_COMPILE = lib.concatStringsSep " " [
      "-std=gnu17"
      "-DINITARGS=void"
      "-DGLYPHPADBYTES=4"
      "-DBITMAP_SCANLINE_UNIT=32"
      "-DBITMAP_BIT_ORDER=LSBFirst"
      "-DIMAGE_BYTE_ORDER=LSBFirst"
    ];
    NIX_LDFLAGS = lib.concatStringsSep " " [
      # libXfont ships server-side stubs (serverGeneration/serverClient) that
      # collide with dix when everything is statically linked for wasm.
      # NIX_LDFLAGS is passed straight to the linker (no -Wl, prefix).
      "--allow-multiple-definition"
      "-L${libXfont}/lib"
      "-L${libfontenc}/lib"
      "-L${zlib}/lib"
      "-lXfont"
      "-lfontenc"
      "-lz"
    ];
  };

  meta = {
    description = "TinyX / Xfbdev server for the wasm framebuffer";
    mainProgram = "Xfbdev";
  };
}
