{
  description = "Nucle, a daily nuclear strike planning puzzle";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # SvelteKit needs Node 22.17 or newer, and vitest doesn't support 23 or 25.
      nodeFor = pkgs: pkgs.nodejs_22;

      # Dependency hashes come from package-lock.json, so there is no separate hash to keep updated.
      # Scripts stay off because the only install script is fsevents, which the build doesn't need.
      siteFor =
        pkgs:
        pkgs.buildNpmPackage {
          pname = "nucle";
          version = "0.0.1";
          src = self;
          nodejs = nodeFor pkgs;
          npmDeps = pkgs.importNpmLock { npmRoot = self; };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          npmFlags = [ "--ignore-scripts" ];
          npmRebuildFlags = [ "--ignore-scripts" ];
          installPhase = ''
            runHook preInstall
            cp -r build $out
            runHook postInstall
          '';
        };
    in
    {
      packages = forAllSystems (pkgs: {
        default = siteFor pkgs;
      });

      # nix run serves the built site. Pass a port to change it from 4173.
      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = nixpkgs.lib.getExe (
            pkgs.writeShellApplication {
              name = "nucle";
              runtimeInputs = [ pkgs.python3 ];
              text = ''
                port="''${1:-4173}"
                echo "Nucle on http://localhost:$port"
                exec python3 -m http.server "$port" --bind 127.0.0.1 --directory ${siteFor pkgs}
              '';
            }
          );
        };
      });

      # nix flake check runs the test suite against the same dependencies as the build.
      checks = forAllSystems (pkgs: {
        test = (siteFor pkgs).overrideAttrs {
          pname = "nucle-test";
          dontNpmBuild = true;
          buildPhase = ''
            runHook preBuild
            npm test
            runHook postBuild
          '';
          installPhase = "touch $out";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ (nodeFor pkgs) ];
        };
      });
    };
}
