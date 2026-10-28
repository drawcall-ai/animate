# animate

Procedural, lifelike motion for three.js characters and creatures, with no animation clips and no runtime ML. A body is a species of a skeleton rigged with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig); a story of verbs, run on your [@pmndrs/timeline](https://github.com/pmndrs/timeline) runner, moves it over a base that stands, walks and looks about by itself — scripted or driven by a player.

```sh
npm install @drawcall/animate @drawcall/rig @pmndrs/timeline three
```

```ts
import { runTimeline } from '@pmndrs/timeline';
import { skin } from '@drawcall/rig';
import { Body, carry, grab, humanoid, release } from '@drawcall/animate';

await skin(characterModel, skeleton); // the skeleton as @drawcall/rig's SkeletonBone[], `as const`
const person = new Body(humanoid(skeleton), { model: characterModel });
scene.add(person.object);

const cup = scene.getObjectByName('cup')!; // userData.mass = 0.3, an empty named 'handle' under it
const tableTop = scene.getObjectByName('tableTop')!; // an empty: +Z the way the person faces putting the cup there
const updateStory = runTimeline(function* () {
  yield* grab(person, cup, { right: 'handle' }); // walks up, looks, reaches
  yield* carry(person, cup, tableTop); // walks there with it, and sets it down
  release(person, cup, tableTop); // the cup now sits on the table top
});

// every frame
updateStory(undefined, delta);
person.update(delta);
```

Import custom-species types and helpers such as `species`, `powerGait` and `swing` from `@drawcall/animate` alongside `Body` and the story verbs.

The package ships its usage guide as a skill: `packages/animate/skills/animate/SKILL.md`.

`packages/animate` is the package; `examples` is the examples app (`pnpm dev`).

The viewer loads its GLBs with `@drawcall/rig`’s `RigLoader`, supplying source metadata to cache weights through the `vitecache()` Vite plugin. Model contents, skeleton, resolution and installed rig/three versions invalidate cached weights. Run the viewer before building to populate `examples/public/_vitecache/`; Vite includes these ignored cache files in the deployment. The production site reads caches but does not write them.

The Vite config excludes rig from dependency prebundling to preserve worker URLs and serves COOP/COEP headers for parallel WASM workers; configure those headers on the deployment host too to parallelize cache misses.
