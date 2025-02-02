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
        zsh
        nodejs_18
        corepack_18
      ];

      shellHook = ''
        exec zsh
      '';
    };
  in {
    devShells = forAllSystems (system: {
      default = mkDevShell system;
    });
  };
}
