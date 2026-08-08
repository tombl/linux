{ stdenv, linux }:

stdenv.mkDerivation {
  pname = "fbtest";
  version = "0.1.0";
  src = ./.;

  buildInputs = [ linux.headers ];

  buildPhase = ''
    $CC -Wall -Wextra -O2 -static -o fbtest fbtest.c
  '';

  installPhase = ''
    mkdir -p $out/bin
    cp fbtest $out/bin/
  '';
}
