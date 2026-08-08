{
  pkgs,
  stdenv,
  xorgproto,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXdmcp-1.1.5.tar.xz";
    hash = "sha256-2KUiKCjDratwrfaaVYPx0y617OBDBPf4OStqNTqiIow=";
  },
}:

stdenv.mkDerivation {
  pname = "libXdmcp";
  version = "1.1.5";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [ xorgproto ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}
