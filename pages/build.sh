#!/bin/sh
# Builds every example into dist/<example>/, as GitHub Pages serves it below /animate/<example>/, beside the index
# that lists them all.
set -eu
rm -rf dist
mkdir dist
cp pages/index.html dist/
for page in examples/*/index.html; do
  example=$(basename "$(dirname "$page")")
  grep -q "href=\"$example/\"" pages/index.html || { echo "pages/index.html does not list $example" >&2; exit 1; }
  pnpm -C "examples/$example" exec vite build --base "/animate/$example/" --outDir "../../dist/$example" --emptyOutDir
done
