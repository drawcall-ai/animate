# animate

Procedural, humanlike motion for three.js characters. A body is moved by behaviours written as
[@pmndrs/timeline](https://github.com/pmndrs/timeline) timelines, layered in order: each writes the
bones it controls, steering them from the poses before — no animation clips, no runtime ML.

```sh
npm install @drawcall/animate three @pmndrs/viverse
```

```ts
import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { follow, Humanoid, INDEX, solveChain, type Frame } from '@drawcall/animate';

const model = await loadCharacterModel();
scene.add(model.scene);
const goal = new Vector3(-0.3, 1.2, 0.4);
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

To check a scenario after every change, `pnpm judge <scenario>` runs it headless in about a second
and prints what fails, worst first: each failure's value against its limit, when, the task running
then (`grab@pickup.ts:82`) and the usual fix, then how the motion flows from one task into the next
(dead time, the eyes leading the hands, reach profiles). `--vary N` adds N seeded variations of the
actors' start, `--json` saves the results to `examples/.judge/` and tells what changed since the last
run, and `--look` renders the moments worth a look with a yes/no question list for each. It exits 1
when a check fails; scenarios without their own limits are held to the universal ones.
