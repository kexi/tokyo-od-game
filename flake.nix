{
  description = "TOKYO OPEN DRIVE — three.js driving game on Tokyo open data";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, treefmt-nix, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      treefmt = forAll (
        pkgs:
        treefmt-nix.lib.evalModule pkgs {
          projectRootFile = "flake.nix";
          programs.nixfmt.enable = true;
          programs.oxfmt.enable = true;
          programs.just.enable = true;
          programs.shellcheck.enable = true;
          programs.ruff-format.enable = true;
          settings.global.excludes = [
            "public/data/**"
            "pnpm-lock.yaml"
          ];
        }
      );
    in
    {
      # `nix fmt` formats every language in the repo (nix / TS / CSS / justfile / shell).
      formatter = forAll (pkgs: treefmt.${pkgs.system}.config.build.wrapper);
      checks = forAll (pkgs: {
        formatting = treefmt.${pkgs.system}.config.build.check ./.;
      });
      devShells = forAll (
        pkgs:
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              pnpm
              just
              lefthook
              gitleaks
              pinact
              actionlint
              shellcheck
              ruff
            ];
            shellHook = ''
              lefthook install >/dev/null 2>&1 || true
            '';
          };
        }
        # Blender (~1.6 GB) only regenerates public/models/*.glb (`just car-model`), so it lives in its
        # own shell instead of the default one that CI and every contributor enter. nixpkgs no longer
        # evaluates x86_64-darwin packages, hence the guard.
        // pkgs.lib.optionalAttrs (pkgs.stdenv.hostPlatform.system != "x86_64-darwin") {
          blender = pkgs.mkShell { packages = [ pkgs.blender ]; };
        }
      );
    };
}
