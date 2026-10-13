# animate

Procedural, humanlike motion for three.js characters. A body is moved by behaviours written as
[@pmndrs/timeline](https://github.com/pmndrs/timeline) timelines, layered in order: each writes the
bones it controls, steering them from the poses before — no animation clips, no runtime ML.

```sh
npm install @drawcall/animate three @pmndrs/viverse
```

```ts
import { action } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { follow, Humanoid, INDEX, solveChain, type Frame } from '@drawcall/animate';

const model = await loadCharacterModel();
scene.add(model.scene);
const body = new Humanoid(model, () =>
  function* () {
    // the right hand to a goal, as fast as a hand moves
    yield* action<Frame>({
      update: (f) => {
        const hand = follow(f.prev2.position(INDEX.rightHand), f.prev.position(INDEX.rightHand), goal, { accel: 8, speed: 1.5 }, f.dt);
        solveChain(f, 'rightArm', { tip: { position: hand } });
      },
    });
  },
);

// each frame
body.update(delta);
```

The package ships its usage guide as a skill: `packages/animate/skills/animate/SKILL.md`.

## Repository

- `packages/animate` — the `@drawcall/animate` package
- `examples` — the examples app (`pnpm dev`), its motion metrics (`pnpm metrics`) and capture tooling
  (`pnpm capture`)
