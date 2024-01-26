{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    go
    nodePackages.tailwindcss
    python311Packages.grip
  ];
  shellHook = ''
    export PATH=$PATH:~/go/bin
  '';
}
