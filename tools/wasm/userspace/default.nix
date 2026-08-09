# Wasm userspace overlay: GUI / interactive packages for wasm32-unknown-linux-musl.
# Import as `import ./tools/wasm/userspace { inherit pkgs wasmpkgs; }` where
# `wasmpkgs` is the distro flake's legacyPackages for this system.
{
  pkgs,
  wasmpkgs,
}:

wasmpkgs.overrideScope (
  final: _prev: {
    htop = final.callPackage ./htop/package.nix { };
    p7zip = final.callPackage ./p7zip/package.nix { };
    fbtest = final.callPackage ./fbtest/package.nix { };

    # X11 protocol / transport (libX11 still needs a static libxcb).
    xorgproto = final.callPackage ./xorgproto/package.nix { };
    xcb-proto = final.callPackage ./xcb-proto/package.nix { };
    libpthread-stubs = final.callPackage ./libpthread-stubs/package.nix { };
    libxcb = final.callPackage ./libxcb/package.nix { };
    xtrans = final.callPackage ./xtrans/package.nix { };
    libXau = final.callPackage ./libXau/package.nix { };
    libXdmcp = final.callPackage ./libXdmcp/package.nix { };

    libX11 = final.callPackage ./libX11/package.nix { };
    libXext = final.callPackage ./libXext/package.nix { };
    libXrender = final.callPackage ./libXrender/package.nix { };
    libXfixes = final.callPackage ./libXfixes/package.nix { };
    libXdamage = final.callPackage ./libXdamage/package.nix { };
    libXcomposite = final.callPackage ./libXcomposite/package.nix { };
    libXcursor = final.callPackage ./libXcursor/package.nix { };
    libXi = final.callPackage ./libXi/package.nix { };
    libXrandr = final.callPackage ./libXrandr/package.nix { };
    libXinerama = final.callPackage ./libXinerama/package.nix { };
    libXtst = final.callPackage ./libXtst/package.nix { };

    libffi = final.callPackage ./libffi/package.nix { };
    pcre2 = final.callPackage ./pcre2/package.nix { };
    glib = final.callPackage ./glib/package.nix {
      inherit (final) libffi pcre2 zlib;
    };
    expat = final.callPackage ./expat/package.nix { };
    freetype = final.callPackage ./freetype/package.nix { };
    fontconfig = final.callPackage ./fontconfig/package.nix { };
    fribidi = final.callPackage ./fribidi/package.nix { };
    harfbuzz = final.callPackage ./harfbuzz/package.nix {
      inherit (final) zlib libpng;
    };
    pixman = final.callPackage ./pixman/package.nix { };
    cairo = final.callPackage ./cairo/package.nix { };
    gdk-pixbuf = final.callPackage ./gdk-pixbuf/package.nix {
      inherit (final) glib libpng zlib;
    };
    pango = final.callPackage ./pango/package.nix {
      inherit (final)
        glib
        cairo
        freetype
        fontconfig
        harfbuzz
        fribidi
        libpng
        zlib
        expat
        pixman
        libX11
        libXext
        libXrender
        libxcb
        xorgproto
        ;
    };
    libICE = final.callPackage ./libICE/package.nix { };
    libSM = final.callPackage ./libSM/package.nix { };
    libXt = final.callPackage ./libXt/package.nix { };
    libXmu = final.callPackage ./libXmu/package.nix { };
    libXpm = final.callPackage ./libXpm/package.nix { };
    libXaw = final.callPackage ./libXaw/package.nix { };

    libfontenc = final.callPackage ./libfontenc/package.nix { };
    libXfont = final.callPackage ./libXfont/package.nix { };
    font-misc-misc = final.callPackage ./font-misc-misc/package.nix { };
    font-cursor-misc = final.callPackage ./font-cursor-misc/package.nix { };

    tinyx = final.callPackage ./tinyx/package.nix { };
    xterm = final.callPackage ./xterm/package.nix { };
    aurora-wm = final.callPackage ./aurora-wm/package.nix { };

    # Networking userland (distro packages, already wasm32-musl).
    inherit (wasmpkgs) curl openssl;

    cacert = final.callPackage ./cacert/package.nix { };
    libpng = final.callPackage ./libpng/package.nix { };

    # Graphical Links (Xlib) — runnable TinyX browser.
    links = final.callPackage ./links/package.nix { };

    # NetSurf leaf libs (X/xcb-util surface still WIP).
    netsurfLibs = final.callPackage ./netsurf { };
    inherit (final.netsurfLibs)
      netsurf-buildsystem
      libwapcaplet
      libparserutils
      libhubbub
      libcss
      libdom
      libnsbmp
      libnsgif
      ;

    # Firefox/SpiderMonkey experiment (meta.broken until mach configure works).
    firefox = final.callPackage ./firefox/package.nix { };

    gui-rootfs = final.callPackage ./gui-rootfs/package.nix { };
    # Browser demo prefers initramfs (see gui-rootfs.passthru.initramfs).
    gui-initramfs = final.gui-rootfs.passthru.initramfs;
  }
)
