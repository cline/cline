{
  description = "Roo Code development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-24.11";
  };

  outputs = { self, nixpkgs, ... }: let
    system = "aarch64-darwin";
  in {
    devShells."${system}".default = let
      pkgs = import nixpkgs { inherit system; };
    in pkgs.mkShell {
      name = "roo-code";

      packages = with pkgs; [
        nodejs_20
        zsh
      ];

      shellHook = ''
        echo "node `${pkgs.nodejs}/bin/node --version`"
        exec zsh
      '';
    };
  };
}
