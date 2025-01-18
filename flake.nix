{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-24.11";
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
              llvm = pkgs.llvmPackages_19;
            in
            {
              default = pkgs.stdenvNoCC.mkDerivation {
                pname = "linux";
                version = "6.1.69-wasm";
                src = ./.;

                nativeBuildInputs = with pkgs; [
                  perl
                  bc
                  bison
                  flex

                  pkg-config
                  ncurses

                  dtc
                  llvm.clang-unwrapped
                  llvm.lld
                  llvm.libllvm
                  wabt
                  esbuild
                  typescript

                  just
                  miniserve
                ];

                HOSTCC = "${llvm.clang}/bin/clang";

                enableParallelBuilding = true;
                configurePhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES defconfig";
                buildPhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES -C tools/wasm";
                installPhase = ''cp -r tools/wasm/dist $out'';
              };
            }
          );
    };
}
