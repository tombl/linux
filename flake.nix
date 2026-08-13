{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
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
                version = "7.1.5-wasm";
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
                ];

                HOSTCC = "${llvm.clang}/bin/clang";
                KBUILD_BUILD_TIMESTAMP = "1970-01-01 00:00:00 UTC";

                enableParallelBuilding = true;
                configurePhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES defconfig";
                buildPhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES vmlinux.wasm";
                installPhase = "cp vmlinux.wasm $out";
              };
            }
          );
    };
}
