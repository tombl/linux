# Twibright Links — text-mode browser for TinyX/xterm (HTTPS via virtio-net proxy).
{
  pkgs,
  stdenv,
  lib,
  openssl,
  zlib,
  libpng,
  libX11,
  libXext,
  libXau,
  libxcb,
  src ? pkgs.fetchurl {
    url = "http://links.twibright.com/download/links-2.30.tar.bz2";
    hash = "sha256-xGMca1oRUnzcPLeHL8I7fyslwrAh1Za+QQ2ttAMV8WY=";
  },
}:

stdenv.mkDerivation {
  pname = "links";
  version = "2.30";
  inherit src;

  nativeBuildInputs = [ pkgs.pkg-config ];

  buildInputs = [
    openssl
    zlib
    libpng
    libX11
    libXext
    libXau
    libxcb
  ];

  configureFlags = [
    "--disable-graphics"
    "--without-libevent"
    "--without-librsvg"
    "--without-libjpeg"
    "--without-libtiff"
    "--without-openmp"
    "--with-ssl=${openssl}"
    "--with-zlib=${zlib}"
    "--without-x"
    "--without-gpm"
    "--without-directfb"
    "--without-svgalib"
    "--without-fb"
  ];

  env.NIX_CFLAGS_COMPILE = "-fcommon -g0";
  env.CFLAGS = "-O2 -g0";

  postPatch = ''
    cp ${./charsets-data.c} charsets-data.c
    cp ${./charsets-data.h} charsets-data.h
    cp ${./charsets-local.h} charsets-local.h

    substituteInPlace charsets.c \
      --replace '#include "links.h"

int utf8_table;

struct table_entry {
	unsigned char c;
	int u;
};

struct codepage_desc {
	const char *name;
	const char * const *aliases;
	const struct table_entry *table;
};

#include "codepage.inc"
#include "uni_7b.inc"
#include "entity.inc"
#include "upcase.inc"
#include "locase.inc"' \
'#include "links.h"
#include "charsets-data.h"

int utf8_table;'

    substituteInPlace uni_7b.inc \
      --replace 'static_const struct { int x; char *s; } unicode_7b' \
      'static_const struct unicode_7b_entry unicode_7b'
    substituteInPlace entity.inc \
      --replace 'static_const struct { const char *s; int c; } entities' \
      'static_const struct entity_entry entities'
    substituteInPlace upcase.inc \
      --replace 'static_const struct { unsigned short o; unsigned short n; } unicode_upcase' \
      'static_const struct case_map_entry unicode_upcase'
    substituteInPlace locase.inc \
      --replace 'static_const struct { unsigned short o; unsigned short n; } unicode_locase' \
      'static_const struct case_map_entry unicode_locase'

    ${pkgs.python3}/bin/python3 <<'PY'
from pathlib import Path
src = Path("charsets.c").read_text()
header = '#include "links.h"\n#include "charsets-data.h"\n#include "charsets-local.h"\n\n'
body = src[src.index("static_const unsigned char strings"):]
split0b = body.index("#define U_EQUAL")
splitU2cp = body.index("unsigned char *u2cp")
splitA = body.index("int cp2u")
splitEnc = body.index("unsigned char *encode_utf_8")
splitAdd = body.index("static void add_utf_8")
splitB = body.index("int get_entity_number")
splitC = body.index("unsigned uni_locase")
Path("charsets-tables.c").write_text(
    '#include "links.h"\n#include "charsets-local.h"\n\n#undef static_const\n#define static_const\n\n'
    + body[:split0b]
)
stub = (
    "int utf8_table;\n\n"
    "static int is_nbsp(int u) { return u == 0xa0 || u == 0x202f; }\n\n"
    "unsigned char *u2cp(int u, int to, int fallback) { (void)u;(void)to;(void)fallback; return (unsigned char *)\"\"; }\n\n"
)
Path("charsets-encode.c").write_text(header + stub + body[splitA:splitAdd])
Path("charsets-conv.c").write_text(header + "extern int utf8_table;\n\n" + body[splitAdd:splitB])
Path("charsets-entity.c").write_text(header + "extern int utf8_table;\n\n" + body[splitB:splitC])
Path("charsets-extra.c").write_text(header + "extern int utf8_table;\n\n" + body[splitC:])
Path("charsets.c").unlink(missing_ok=True)
PY

    substituteInPlace charsets-tables.c \
      --replace 'static void free_translation_table' 'void free_translation_table' \
      --replace 'static void new_translation_table' 'void new_translation_table'

    substituteInPlace Makefile.in \
      --replace 'cache.c charsets.c compress.c' \
      'cache.c charsets-data.c charsets-tables.c charsets-encode.c charsets-conv.c charsets-entity.c charsets-extra.c compress.c'
  '';

  postConfigure = ''
    sed -i 's/charsets\.o /charsets-data.o charsets-tables.o charsets-encode.o charsets-conv.o charsets-entity.o charsets-extra.o /' Makefile
    sed -i 's/charsets-u2cp\.o //g; s/charsets-cp2u\.o //g; s/ charsets-u2cp\.o//g; s/ charsets-cp2u\.o//g; /charsets-u2cp/d; /charsets-cp2u/d' Makefile
    for f in charsets-encode charsets-conv charsets-entity charsets-extra; do
      echo "$f.o: CFLAGS += -O0 -fno-strict-aliasing" >> Makefile
    done
    echo 'bfu.o: CFLAGS += -O0 -fno-strict-aliasing' >> Makefile
  '';

  meta = {
    description = "Twibright Links text/graphics web browser";
    homepage = "http://links.twibright.com/";
    license = lib.licenses.gpl2Only;
    broken = true; # charsets-encode.c still ICEs (clang 22 wasm); data/tables split lands
  };
}
