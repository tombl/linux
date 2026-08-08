{
  apk,
  apk-tools,
  busybox,
  guest-agent,
  htop,
  p7zip,
  tinyx,
  xterm,
  font-misc-misc,
  font-cursor-misc,
  ncurses,
  image,
  pkgs,
}:

let
  # Self-contained repository for the GUI demo image.
  guiRepository = apk.mkRepository {
    name = "gui-repository";
    packages = {
      inherit
        busybox
        apk-tools
        guest-agent
        htop
        p7zip
        tinyx
        xterm
        font-misc-misc
        font-cursor-misc
        ncurses
        ;
    };
  };

  system = apk.mkSystem {
    name = "gui-rootfs";
    repositories = [ guiRepository ];
    packages = [
      busybox
      apk-tools
      guest-agent
      htop
      p7zip
      tinyx
      xterm
      font-misc-misc
      font-cursor-misc
      ncurses
    ];
    files = {
      "/init" = {
        source = ./init.sh;
        mode = "0755";
      };
      "/etc/resolv.conf" = pkgs.writeText "resolv.conf" ''
        nameserver 192.0.2.1
      '';
    };
  };

  # Prefer initramfs in the browser demo: virtio-blk ext4 boot has been flaky.
  initramfs = pkgs.runCommand "gui-rootfs.cpio" {
    nativeBuildInputs = [
      pkgs.cpio
      pkgs.findutils
    ];
  } ''
    mkdir root
    cp -a --no-preserve=ownership ${system}/. root/
    chmod -R u+w root
    mkdir -p root/dev root/proc root/sys root/tmp root/run root/root root/workspace
    chmod 01777 root/tmp
    cd root
    find . -print0 | sort -z | cpio --null --reproducible --owner=0:0 -H newc -o > $out
  '';

  ext4 = image.mkFilesystem {
    name = "gui-rootfs";
    root = system;
    format = "ext4";
    size = "128M";
  };
in
# Default output stays the ext4 image; passthru exposes the initramfs sibling.
ext4.overrideAttrs (old: {
  passthru = (old.passthru or { }) // {
    inherit system initramfs;
  };
})
