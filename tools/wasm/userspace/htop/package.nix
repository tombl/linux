{
  pkgs,
  stdenv,
  ncurses,
  src ? pkgs.fetchFromGitHub {
    owner = "htop-dev";
    repo = "htop";
    rev = "3.3.0";
    hash = "sha256-qDhQkzY2zj2yxbgFUXwE0MGEgAFOsAhnapUuetO9WTw=";
  },
}:

stdenv.mkDerivation {
  pname = "htop";
  version = "3.3.0";
  inherit src;

  nativeBuildInputs = [
    pkgs.autoreconfHook
    pkgs.pkg-config
  ];

  buildInputs = [ ncurses ];

  # Static guest binary: no sensors/hwloc/capabilities/delayacct, and no
  # openvz/vserver probes that pull optional Linux features we do not ship.
  configureFlags = [
    "--enable-static"
    "--enable-unicode"
    "--disable-shared"
    "--disable-openvz"
    "--disable-vserver"
    "--disable-ancient_vserver"
    "--disable-hwloc"
    "--disable-sensors"
    "--disable-capabilities"
    "--disable-delayacct"
    "--disable-affinity"
    "--disable-pcp"
    "--disable-unwind"
  ];

  # setupterm() needs a large stack on this target; the stdenv linker flags
  # already set 8 MiB, which matches the ncurses port notes.
}
