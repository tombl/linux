{
  pkgs,
  stdenv,
  xorgproto,
  src ? pkgs.fetchurl {
    url = "https://www.x.org/releases/individual/lib/libXau-1.0.12.tar.xz";
    hash = "sha256-dNDk36PTmtiTnpm9o39ZZ6ulKCEQdoKEZNJ3fUd/wPs=";
  },
}:

stdenv.mkDerivation {
  pname = "libXau";
  version = "1.0.12";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];
  buildInputs = [ xorgproto ];
  propagatedBuildInputs = [ xorgproto ];

  configureFlags = [
    "--disable-shared"
    "--enable-static"
  ];
}