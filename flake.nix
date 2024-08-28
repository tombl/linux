{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-24.05";
  };
  outputs =
    { self, nixpkgs }:
    {
      packages =
        nixpkgs.lib.genAttrs
          [
            "x86_64-linux"
            "aarch64-linux"
            "x86_64-darwin"
            "aarch64-darwin"
          ]
          (
            system:
            let
              pkgs = nixpkgs.legacyPackages.${system};
              llvm = pkgs.llvmPackages_17;
            in
            {
              default = pkgs.stdenvNoCC.mkDerivation {
                pname = "linux";
                version = "6.1.69-wasm";
                src = ./.;

                nativeBuildInputs = with pkgs; [
                  perl
                  bc
                  nettools
                  openssl
                  rsync
                  gmp
                  libmpc
                  mpfr
                  zstd
                  python3Minimal
                  kmod
                  ubootTools
                  bison
                  flex
                  cpio
                  pahole
                  zlib
                  elfutils

                  pkg-config
                  ncurses

                  dtc
                  llvm.clang-unwrapped
                  llvm.lld
                  llvm.libllvm
                  wabt
                  esbuild
                  typescript
                ];

                HOSTCC = "${llvm.clang}/bin/clang";

                enableParallelBuilding = true;
                configurePhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES defconfig";
                buildPhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES -C tools/wasm";
                installPhase = ''
                  mkdir $out
                  rm tools/wasm/public/dist
                  cp tools/wasm/public/* $out/
                  cp -r tools/wasm/dist $out/dist
                '';
              };
            }
          );
    };
}
