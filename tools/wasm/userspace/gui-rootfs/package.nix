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
in
image.mkFilesystem {
  name = "gui-rootfs";
  root = system;
  format = "ext4";
  size = "128M";
}
