# animate

Procedural, lifelike motion for three.js characters and creatures, with no animation clips and no runtime ML. A body is a species of a skeleton rigged with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig); a story of verbs, run on your [@pmndrs/timeline](https://github.com/pmndrs/timeline) runner, moves it over a base that stands, walks and looks about by itself — scripted or driven by a player.

Install with `pnpm add @drawcall/animate @drawcall/rig @pmndrs/timeline three`. Import all bodies, verbs and custom-species helpers from `@drawcall/animate`. See the [package README](packages/animate/README.md) for a quick start and the [animate skill](packages/animate/skills/animate/SKILL.md) for usage patterns.

`packages/animate` is the package; `examples` is the examples app (`pnpm dev`).

The viewer loads its GLBs with `@drawcall/rig`’s `RigLoader`, supplying source metadata to cache weights through the `vitecache()` Vite plugin. Model contents, skeleton, resolution and installed rig/three versions invalidate cached weights. Run the viewer before building to populate `examples/public/_vitecache/`; Vite includes these ignored cache files in the deployment. The production site reads caches but does not write them.

The Vite config excludes rig from dependency prebundling to preserve worker URLs and serves COOP/COEP headers for parallel WASM workers; configure those headers on the deployment host too to parallelize cache misses.

Run `pnpm check` on Node 22.18.0 before release. Stable `vX.Y.Z` tags trigger the npm workflow, which sets the package version from the tag, verifies it and publishes with OIDC provenance. The repository metadata currently assumes `drawcall-ai/animate`; confirm it and configure npm’s trusted publisher for `publish-package.yml` before releasing.
