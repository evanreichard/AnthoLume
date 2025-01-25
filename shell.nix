{ pkgs ? import <nixpkgs> { } }:

let
  unstable = import <nixpkgs-unstable> { };
in
pkgs.mkShell {
  packages = with pkgs; [
    go
    nodejs
    nodePackages.tailwindcss
    unstable.templ
    python311Packages.grip
  ];
  shellHook = ''
    export PATH=$PATH:~/go/bin
  '';
}
