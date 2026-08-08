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

    libX11 = final.callPackage ./libX11/package.nix { };
    libXext = final.callPackage ./libXext/package.nix { };
    libICE = final.callPackage ./libICE/package.nix { };
    libSM = final.callPackage ./libSM/package.nix { };
    libXt = final.callPackage ./libXt/package.nix { };
    libXmu = final.callPackage ./libXmu/package.nix { };
    libXpm = final.callPackage ./libXpm/package.nix { };
    libXaw = final.callPackage ./libXaw/package.nix { };

    libfontenc = final.callPackage ./libfontenc/package.nix { };
    libXfont = final.callPackage ./libXfont/package.nix { };
    font-misc-misc = final.callPackage ./font-misc-misc/package.nix { };

    tinyx = final.callPackage ./tinyx/package.nix { };
    xterm = final.callPackage ./xterm/package.nix { };
    gui-rootfs = final.callPackage ./gui-rootfs/package.nix { };
  }
)
