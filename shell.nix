{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    go
    nodePackages.tailwindcss
    python311Packages.grip
  ];
}
