{
  description = "Roo Code development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-24.11";
  };

  outputs = { self, nixpkgs, ... }: let
    systems = [ "aarch64-darwin" "x86_64-linux" ];

    forAllSystems = nixpkgs.lib.genAttrs systems;

    mkDevShell = system: let
      pkgs = import nixpkgs { inherit system; };
    in pkgs.mkShell {
      name = "roo-code";
      
      packages = with pkgs; [
        nodejs_20
        corepack_20
      ];
    };
  in {
    devShells = forAllSystems (system: {
      default = mkDevShell system;
    });
  };
}
