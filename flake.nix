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
              sourceRev = self.rev or self.dirtyRev or "unknown";
              npmVersion = "0.0.0-${builtins.substring 0 8 sourceRev}";
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
                  nodejs

                  just
                  miniserve
                ];

                HOSTCC = "${llvm.clang}/bin/clang";

                enableParallelBuilding = true;
                configurePhase = "make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES defconfig";
                buildPhase = "
                  # this is a horrible dirty hack but there's some non-deterministic build failure
                  built=0
                  for i in $(seq 1 3); do
                    if make HOSTCC=$HOSTCC -j$NIX_BUILD_CORES -C tools/wasm PACKAGE_VERSION=${npmVersion} pack; then
                      built=1
                      break
                    fi
                  done
                  test $built -eq 1
                ";
                installPhase = "cp tools/wasm/linux.tgz $out";
              };
            }
          );
    };
}
