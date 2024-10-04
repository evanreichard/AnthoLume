{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    go
    nodejs
    nodePackages.tailwindcss
    templ
    python311Packages.grip
  ];
  shellHook = ''
    export PATH=$PATH:~/go/bin
  '';
}
