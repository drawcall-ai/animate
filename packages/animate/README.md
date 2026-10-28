# animate

Procedural, lifelike motion for three.js characters and creatures, with no animation clips and no runtime ML. A body is a species of a skeleton rigged with [@drawcall/rig](https://www.npmjs.com/package/@drawcall/rig); a story of verbs, run on your [@pmndrs/timeline](https://github.com/pmndrs/timeline) runner, moves it over a base that stands, walks and looks about by itself — scripted or driven by a player.

```sh
pnpm add @drawcall/animate @drawcall/rig @pmndrs/timeline three
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

For usage patterns and skeleton examples, see the [animate skill](skills/animate/SKILL.md), shipped with the package.
