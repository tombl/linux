# NetSurf library chain (work-in-progress). The X surface needs xcb-util-*
# packages not yet in this overlay; see ../links for the runnable browser.
# This file exports the leaf libs that build today so Firefox/NetSurf can share them.
{
  pkgs,
  lib,
  stdenv,
  zlib,
}:

let
  netsurf-buildsystem = stdenv.mkDerivation rec {
    pname = "netsurf-buildsystem";
    version = "1.10";
    src = pkgs.fetchurl {
      url = "https://download.netsurf-browser.org/libs/releases/buildsystem-${version}.tar.gz";
      hash = "sha256-PT451WnkRnfEsXkSm95hTGV5jis+YlMWAjnR/W6uTXk=";
    };
    makeFlags = [ "PREFIX=$(out)" ];
  };

  nsLib =
    {
      pname,
      version,
      hash,
      url ? "https://download.netsurf-browser.org/libs/releases/${pname}-${version}-src.tar.gz",
      buildInputs ? [ ],
      extraMakeFlags ? [ ],
    }:
    stdenv.mkDerivation {
      inherit pname version;
      src = pkgs.fetchurl { inherit url hash; };
      nativeBuildInputs = [
        pkgs.pkg-config
        pkgs.perl
        pkgs.which
        pkgs.gperf
      ];
      buildInputs = [ netsurf-buildsystem ] ++ buildInputs;
      makeFlags = [
        "PREFIX=$(out)"
        "NSSHARED=${netsurf-buildsystem}/share/netsurf-buildsystem"
        "COMPONENT_TYPE=lib-static"
      ] ++ extraMakeFlags;
      env.NIX_CFLAGS_COMPILE = "-fcommon";
    };

  libwapcaplet = nsLib {
    pname = "libwapcaplet";
    version = "0.4.3";
    hash = "sha256-myqh3W1mRfjpkrNpf9vYfwwOHaVyH6VO0ptITRMWDFw=";
  };

  libparserutils = nsLib {
    pname = "libparserutils";
    version = "0.2.5";
    hash = "sha256-MX7VxxjxeSe1chl0uuXeMsP9bQVdsTGtMbQxKgMu0Tk=";
  };

  libhubbub = nsLib {
    pname = "libhubbub";
    version = "0.3.8";
    hash = "sha256-isHm9fPUjAUUHVk5FxlTQpDFnNAp78JJ60/brBAs1aU=";
    buildInputs = [
      libparserutils
      libwapcaplet
    ];
  };

  libcss = nsLib {
    pname = "libcss";
    version = "0.9.2";
    hash = "sha256-LfIVu+w01R1gwaBLAbLfTV0Y9RDx86evS4DN21ZxFU4=";
    buildInputs = [
      libparserutils
      libwapcaplet
    ];
  };

  libdom = nsLib {
    pname = "libdom";
    version = "0.4.2";
    hash = "sha256-0F5FrxZUcBTCsKOuzzZw+hPUGfUFs/X8esihSR/DDzw=";
    buildInputs = [
      libhubbub
      libparserutils
      libwapcaplet
    ];
  };

  libnsbmp = nsLib {
    pname = "libnsbmp";
    version = "0.1.7";
    hash = "sha256-VAenaCoSK6qqWhW1BSkOLTffVME8Xt70sJ0SyGLYIpM=";
  };

  libnsgif = nsLib {
    pname = "libnsgif";
    version = "1.0.0";
    hash = "sha256-YBTIQvYUVNL1oPgkPXqNe96bfaPM/cotNGx8CyxMBhs=";
  };

  libpng = stdenv.mkDerivation rec {
    pname = "libpng";
    version = "1.6.58";
    src = pkgs.fetchurl {
      url = "https://downloads.sourceforge.net/libpng/libpng-${version}.tar.xz";
      hash = "sha256-KOtAP1Hw90BSSRMs7P6C6lwO+X8bMsWmWCiBSuDTR3U=";
    };
    buildInputs = [ zlib ];
    configureFlags = [
      "--disable-shared"
      "--enable-static"
    ];
  };
in
{
  inherit
    netsurf-buildsystem
    libpng
    libwapcaplet
    libparserutils
    libhubbub
    libcss
    libdom
    libnsbmp
    libnsgif
    ;
}
