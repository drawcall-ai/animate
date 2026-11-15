#!/bin/sh
# Makes the proof videos in a folder (one folder a pull request, as on the `proof` branch) into pages that play them:
# an index of the folders, newest first, and in each a page of its videos.
set -eu
cd "$1"
page() {
  printf '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>%s</title><style>body{margin:0 auto;max-width:960px;padding:16px;background:#202020;color:#e0e0e0;font:15px/1.5 system-ui,sans-serif}a{color:#8cb4ff}video{width:100%%;max-height:80vh;background:#000}h2{font-size:15px;margin:24px 0 6px}</style></head><body><h1>%s</h1>\n' "$1" "$1"
}
page 'Proof videos' >index.html
for folder in $(ls -d */ | sed 's#/##' | sort -t- -k2 -n -r); do
  case $folder in
    pr-*) link="https://github.com/drawcall-ai/animate/pull/${folder#pr-}" ;;
    *) link="https://github.com/drawcall-ai/animate/commit/${folder#main-}" ;;
  esac
  printf '<p><a href="%s/">%s</a> · <a href="%s">on GitHub</a></p>\n' "$folder" "$folder" "$link" >>index.html
  page "$folder" >"$folder/index.html"
  printf '<p><a href="../">all proof videos</a> · <a href="%s">on GitHub</a></p>\n' "$link" >>"$folder/index.html"
  for video in "$folder"/*.mp4; do
    name=$(basename "$video" .mp4)
    printf '<h2 id="%s">%s</h2><video src="%s.mp4" controls playsinline preload="metadata"></video>\n' "$name" "$name" "$name" >>"$folder/index.html"
  done
done
