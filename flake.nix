{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-23.11";
  };
  outputs = { self, nixpkgs }: {
    packages = nixpkgs.lib.genAttrs
      [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ]
      (system:
        let pkgs = import nixpkgs { inherit system; }; in {
          default = pkgs.clangStdenv.mkDerivation {
            pname = "linux";
            version = "6.1.69";
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

              lld
              libllvm
              pkg-config
              ncurses
            ];

            enableParallelBuilding = true;
            buildPhase = "make -j$NIX_BUILD_CORES tinyconfig vmlinux";
            installPhase = "mkdir $out && cp vmlinux $out/vmlinux";
          };
        });
  };
}
