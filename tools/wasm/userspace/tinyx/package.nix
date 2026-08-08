{
  pkgs,
  stdenv,
  xorgproto,
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
  ];

  nativeBuildInputs = [
    pkgs.autoreconfHook
    pkgs.pkg-config
    pkgs.flex
    pkgs.bison
    pkgs.libtool
    pkgs.util-macros
  ];

  buildInputs = [
    xorgproto
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
    "--with-fontdir=/share/fonts/X11"
    "--with-default-font-path=/share/fonts/X11/misc"
  ];

  # Reinforcing the platform site file: TinyX probes mmap for Xvfb paths.
  preConfigure = ''
    export ac_cv_func_mmap=no
    export ac_cv_func_mmap_fixed_mapped=no
  '';

  # Static link the font stack into Xfbdev.
  env.NIX_LDFLAGS = "-lXfont -lfontenc -lz";

  meta = {
    description = "TinyX / Xfbdev server for the wasm framebuffer";
    mainProgram = "Xfbdev";
  };
}
