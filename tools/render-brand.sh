#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

icons=assets/icons
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rsvg-convert banner.svg -o banner.png
rsvg-convert -w 1024 -h 1024 "$icons/mark.svg" -o "$tmp/mark.png"

tile() {
  local size=$1 inset=$2 output=$3
  magick -size "${size}x${size}" xc:'#f7f4ed' \
    \( "$tmp/mark.png" -resize "${inset}x${inset}" \) -gravity center -composite \
    -strip -define png:exclude-chunk=date,time "PNG24:$output"
}
tile 180 166 "$icons/apple-touch-icon.png"
tile 192 186 "$icons/icon192.png"
tile 512 496 "$icons/icon512.png"
# Mask Safe Zone - Keep all artwork inside the central 80%-diameter circle.
tile 512 415 "$icons/maskable512.png"
for size in 16 32 48; do tile "$size" "$size" "$tmp/$size.png"; done
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$icons/favicon.ico"
