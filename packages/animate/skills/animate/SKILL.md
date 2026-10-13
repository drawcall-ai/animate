---
name: animate
description: Animate three.js characters with @drawcall/animate — compose a humanlike body from behaviours written as @pmndrs/timeline timelines (stand and balance, walk and run, follow a target, reach, carry, look, head tracking), or drive a generic articulated body from your own behaviours. Use when writing code that imports @drawcall/animate.
---

# @drawcall/animate

A body is moved by **one behaviour timeline**. Every 1/60 s sub-step the behaviour *proposes* what it wants — soft targets, hard contacts, joint limits, acceleration caps — and the body merges all proposals and solves the pose. Behaviours never write bones or transforms.

Timelines are [@pmndrs/timeline](https://github.com/pmndrs/timeline) generators: compose them with `parallel`, `action`, `timePassed` and its other helpers.

## Two layers

- **Humanoid** (most uses): `Humanoid` turns a `@pmndrs/viverse` character model (glTF or VRM, as `loadCharacterModel` loads it) into a body and poses the model after every update. The behaviours `humanoid`, `walk`, `follow`, `reach`, `carry`, `look`, `track` give it humanlike motion.
- **Core** (any articulated rig): `Skeleton`, `Body` and the proposal `Board` (`ctx.propose`), for bodies that are not human or for behaviours of your own.

## A humanoid

```ts
import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { createWorld, follow, humanoid, Humanoid, look, type Ctx, type World } from '@drawcall/animate';

const world = createWorld();
const model = await loadCharacterModel();
scene.add(model.scene);

const goal = { position: new Vector3(2, 0.9, 4), weight: 1 };
const body = new Humanoid<World>(
  model,
  (h) =>
    function* () {
      yield* parallel<Ctx<World>>(
        'all',
        humanoid(h), // always: ranges of motion, calm caps, relaxed pose, standing balance
        follow(h, 'hips', { target: () => goal }), // the hips lead; the steps are the body's own
        look(h, () => goal.position),
      );
    },
  { world, position: { x: 0, z: 0 }, yaw: 0 },
);

// every frame
body.update(delta);
```

`new Humanoid(model, behaviour, { world, position, yaw })`: `behaviour` receives the humanoid and returns the timeline; the body starts standing relaxed where it is put. Read back `body.yaw`, `body.velocity`, `body.feet` (each foot's position, yaw and phase), `body.proportions`, `body.state` (the solved bones). One Humanoid per model. Without a model file, `createSkeletonModel(height)` gives a bare-bones character model.

### Behaviours

Run `humanoid(h)` for the whole life of every humanoid, in `parallel` with whatever else it does. It is the fallback everything else overrides.

| behaviour | does | when |
|---|---|---|
| `humanoid(h, { stance? })` | human joint ranges, acceleration caps, the relaxed pose, standing balance with recovery steps | always |
| `walk(h, { to, facing?, speed?, accel?, eager?, until? })` | walks (and, fast, runs) to a moving floor point; stepping, arm swing, pelvis and trunk motion included | you know where the body should go |
| `follow(h, 'hips' \| 'head' \| 'hands', { target, speed?, accel?, until? })` | a body part leads: leans, steps or walks so the part reaches its target (for `'hands'`, the hands' midpoint; move the hands themselves with `reach` or `carry`) | you know where a part should be, not where to stand |
| `reach(h, 'left' \| 'right', target)` | one hand to its target; ramp `weight` 0 → 1 to reach, back to let go | grabbing, pointing, touching |
| `carry(h, { left, right })` | both hands on their targets together | trays, boxes, two-handed holds |
| `look(h, target)` | head, neck and chest turn to a point (`null`: nowhere in particular) | attention, gaze |
| `track(h, target)` | the eyes follow a head pose; the trunk, pelvis and feet turn after it, the knees bend when it goes low | VR headsets, recorded head motion |

Targets are functions of the context, asked every sub-step, returning an `Effector`: `{ position, quaternion?, weight }` (`weight` 0..1). Mutate one object you keep, or return a fresh one. Hand targets are the wrists, the head target is the eye midpoint, foot targets are the ankles.

`until` (a timeline `UntilCondition`) ends `walk` and `follow` gracefully: the body comes to rest, then the timeline finishes, so they compose in sequence:

```ts
yield* walk(h, { to: () => door, until: () => arrived });
yield* reach(h, 'right', () => handle);
```

What a body is asked to do is reported in `h.status.intent` (its effector targets, where it looks); `h.status.feet` has each foot's phase (`planted`, `swing`, `lifted`, `carried`).

### Composition rules

- Things that must stay in sync are one behaviour; independent things are separate behaviours in `parallel`.
- Behaviours only propose. Do not move bones, and do not use timeline's `transition`, `spring` or `lookAt` on body parts.
- No Promises inside behaviours: wait with conditions and `timePassed` (simulation time).
- Stop a behaviour gracefully with its `until`; cancelling it outright is safe too: `humanoid(h)` takes over.

### Several actors

Share one `World` (`createWorld({ floorObstacles, ground, ladders, ... })`). Before updating, set `world.bodies = actors.map((a) => a.snapshot())` so each body reads the others as they were last solved, whatever order they update in.

## The core

Use it for non-human rigs or behaviours the humanoid layer does not offer.

```ts
import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, Skeleton, type Ctx } from '@drawcall/animate';

const skeleton = new Skeleton([
  { name: 'base', parent: -1, offset: new Vector3(), mass: 2, com: new Vector3() },
  { name: 'arm', parent: 0, offset: new Vector3(0, 0.5, 0), mass: 1, com: new Vector3(0, 0.25, 0) },
]);
const body = new Body(skeleton, function* () {
  yield* action<Ctx>({
    update: (ctx) => {
      ctx.propose.contact({ point: { bone: 0, at: new Vector3() }, position: new Vector3(), priority: 1 });
      ctx.propose.target({ kind: 'position', point: { bone: 1, at: new Vector3(0, 0.5, 0) }, value: new Vector3(0.3, 0.4, 0), weight: 1 });
    },
  });
});
body.update(delta); // read body.state
```

Bones are listed parents first; rest rotations are identity (+Y up, facing +Z, +X left). A `Point` is `{ bone, at }` (bone-local) or `'com'`, the centre of mass.

What `ctx.propose` takes, and how proposals from different behaviours combine (order never matters):

| proposal | is | combined |
|---|---|---|
| `target({ kind: 'position' \| 'orientation' \| 'aim' \| 'local', point, value, weight, stiffness?, tier?, claims?, mask? })` | a soft pull | main targets add, and where they conflict settle by their weights (`stiffness` sets only how fast each gets there); a `tier: 'fallback'` target gets only the weight the main ones leave on its bone (the centre of mass counting as the root, bone 0, for positions) |
| `contact({ point, position, rotation?, priority, support?, mask? })` | held exactly, as far as it can be | one per point: the highest priority wins; equal priorities that disagree throw |
| `limit({ bone, axis, swing, twist, neutral? })` | a joint's swing–twist range | intersected |
| `cap({ bone, acceleration, kind? })` | a joint's acceleration cap | the largest wins |
| `load({ bone, mass, at })` | carried mass | added |
| `impulse(point, velocity)` | a sudden velocity change (a hit) | added |

Give proposals an `owner` and read `ctx.granted(owner)` next sub-step: which contacts won or lost and how far each target was left off. `ctx.supports()` lists the weight-bearing winning contacts. The solver has no gravity: support and balance are up to behaviours.
