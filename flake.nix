{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-23.11";
  };
  outputs = { self, nixpkgs }: {
    packages = nixpkgs.lib.genAttrs
      [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
      (system:
        let pkgs = nixpkgs.legacyPackages.${system}; 
           llvm = pkgs.llvmPackages_17;
        in {
          default = llvm.stdenv.mkDerivation {
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
              llvm.lld
              llvm.libllvm
              wabt
              esbuild
            ];

            enableParallelBuilding = true;
            configurePhase = "make -j$NIX_BUILD_CORES tinyconfig debug.config";
            buildPhase = "make -j$NIX_BUILD_CORES arch/wasm/vmlinux.wasm tools/wasm/sections.json tools/wasm";
            installPhase = ''
              mkdir $out
              cp -r tools/wasm/* $out/
              cp arch/wasm/vmlinux.wasm $out/
            '';
          };
        });
  };
}
