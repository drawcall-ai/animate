# animate

Procedural, lifelike motion for three.js characters and creatures, with no animation clips and no runtime ML. A body is a species of a skeleton rigged with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig); a story of verbs, run on your [@pmndrs/timeline](https://github.com/pmndrs/timeline) runner, moves it over a base that stands, walks and looks about by itself — scripted or driven by a player.

```sh
npm install @drawcall/animate @drawcall/rig @pmndrs/timeline three
```

```ts
import { Vector3 } from 'three';
import { runTimeline } from '@pmndrs/timeline';
import { skin } from '@drawcall/rig';
import { Body, carry, grab, humanoid, release } from '@drawcall/animate';

await skin(characterModel, skeleton); // the skeleton as @drawcall/rig's SkeletonBone[], `as const`
const person = new Body(humanoid(skeleton), { model: characterModel });
scene.add(person.object);

const cup = scene.getObjectByName('cup')!; // userData.mass = 0.3, an empty named 'handle' under it
const updateStory = runTimeline(function* () {
  yield* grab(person, cup, { right: 'handle' }); // walks up, looks, reaches
  yield* carry(person, cup, new Vector3(0, 1.1, -2)); // walks there with it
  release(person, cup);
});

// every frame
updateStory(undefined, delta);
person.update(delta);
```

The package ships its usage guide as a skill: `packages/animate/skills/animate/SKILL.md`.

`packages/animate` is the package. `examples` is the examples app (`pnpm dev`), with its scenes' checks (`pnpm run-scene <id>`) and capture tooling; it still uses the pre-v10 API and is being ported.
