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

  # wasm32-linux has no fork(); helper screens that spawn tools fail closed.
  postPatch = ''
    for f in OpenFilesScreen.c TraceScreen.c linux/SystemdMeter.c; do
      substituteInPlace "$f" \
        --replace-fail 'pid_t child = fork();' \
        'pid_t child = -1;'
    done
  '';

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
}
