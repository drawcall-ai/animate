# animate

Procedural, humanlike motion for three.js characters. A body is moved by behaviours written as
[@pmndrs/timeline](https://github.com/pmndrs/timeline) timelines: they propose targets, contacts
and limits, and the body solves a plausible pose from them — no animation clips, no runtime ML.

```sh
npm install @drawcall/animate three @pmndrs/viverse
```

```ts
import { parallel } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { createWorld, humanoid, Humanoid, walk, type Ctx, type World } from '@drawcall/animate';

const model = await loadCharacterModel();
scene.add(model.scene);
const body = new Humanoid<World>(
  model,
  (h) =>
    function* () {
      yield* parallel<Ctx<World>>('all', humanoid(h), walk(h, { to: () => goal }));
    },
  { world: createWorld() },
);

// each frame
body.update(delta);
```

The package ships its usage guide as a skill: `packages/animate/skills/animate/SKILL.md`.

## Repository

- `packages/animate` — the `@drawcall/animate` package
- `examples` — the examples app (`pnpm dev`), its motion metrics (`pnpm metrics`) and capture tooling
  (`pnpm capture`)
