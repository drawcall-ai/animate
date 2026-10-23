# animate

Procedural, lifelike motion for three.js characters and creatures, with no animation clips and no runtime ML. A body is moved by behaviours written as [@pmndrs/timeline](https://github.com/pmndrs/timeline) timelines that flow into one another: it stands, walks, takes, carries and looks, scripted or driven by a player.

```sh
npm install @drawcall/animate @pmndrs/timeline three @pmndrs/viverse
```

```ts
import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { carried, grab, hold, Humanoid, Item, walkTo, type Frame } from '@drawcall/animate';

const cup = new Item(new Vector3(0.3, 0.9, 2), new Quaternion(), { handle: { position: new Vector3() } }, { name: 'cup', mass: 0.3 });
const model = await loadCharacterModel();
scene.add(model.scene);
// (it stands, breathes and looks about by itself; its story runs over that)
const person = new Humanoid(model, (h) => function* () {
  yield* grab(h, { right: [cup, 'handle'] })(); // walks up, looks, reaches
  yield* parallel<Frame>('race', hold(h, cup, { to: carried(h, 'right') }), walkTo(h, { to: new Vector3(0, 0, -2) }));
});

// every frame
person.update(delta);
```

The package ships its usage guide as a skill: `packages/animate/skills/animate/SKILL.md`.

`packages/animate` is the package. `examples` is the examples app (`pnpm dev`), with its scenes' checks (`pnpm run-scene <id>`) and capture tooling.
