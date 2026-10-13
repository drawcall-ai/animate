---
name: animate
description: Animate three.js characters with @drawcall/animate — a body (a humanoid from a @pmndrs/viverse model, or any articulated rig) moved by behaviours written as @pmndrs/timeline timelines that write its pose layer by layer, with chain IK (`solveChain`) and acceleration-limited following (`follow`, `followRotation`). Use when writing code that imports @drawcall/animate.
---

# @drawcall/animate

A body runs **one behaviour timeline**, stepped in fixed sub-steps of 1/60 s (`STEP`): `update(delta)` runs as many as the time covers and carries the rest over. Behaviours are [@pmndrs/timeline](https://github.com/pmndrs/timeline) generators; compose them with `parallel`, `action`, `timePassed` and its other helpers. No Promises inside behaviours: wait with conditions and `timePassed` (simulation time).

## Frames and layers

Each sub-step every running action's `update(frame)` gets a `Frame`:

| field | is |
|---|---|
| `dt`, `time` | the sub-step's length and the time `current` is posed for (s) |
| `world` | the world the body was made with (throws without one) |
| `prev2`, `prev` | the final poses of the two sub-steps before (read only) |
| `current` | this sub-step's pose as written so far; it starts as a copy of `prev` |

Behaviours **write** `current`. Children of a `parallel` are stepped in the order given, so a later behaviour wins on the bones it writes and leaves the rest to the ones before: put the base (a stance) first and overrides after it. A bone nobody writes keeps last sub-step's rotation. The poses rotate every sub-step: read them from the frame each time, never keep them.

Order parents before children: a world position is read where the bones are when it is read, so a later write to a parent (the spine) moves the tips of chains solved before it (the hands). Write the trunk, then the limbs.

A `Pose`, by bone index:
- read: `local(bone)` (rotation in the parent's frame; the root's in the world's), `position(bone)` and `rotation(bone)` (world), `point(bone, at, out)`, `com(out)`
- write: `setLocal(bone, q, weight?)`, `setRotation(bone, worldQ, weight?)`, `setRoot(position, weight?)`; a `weight` below 1 blends over what the layers before wrote this sub-step — with none before, over the last pose, which eases toward the value at a rate that depends on the sub-step: use `follow` for that instead

Nothing smooths, limits or fades for you. A behaviour moves its bones on from the history at speeds it chooses (`follow`, `followRotation`), and so hands over continuously: when a layer above ends, the bones are where it left them, moving as it moved them, and the layer below takes them on from there. A layer that sets bones outright (`setLocal(bone, rotation)`) snaps them instead — so the base layer too follows its pose:

```ts
action<Frame>({
  update: (f) => {
    for (const { bone, rotation } of relaxedPose()) f.current.setLocal(bone, followRotation(f.prev2.local(bone), f.prev.local(bone), rotation, { accel: 30 }, f.dt, q));
  },
});
```

## Helpers

- `solveChain(frame, chain, { tip: { position, quaternion? }, pole? }, weight?)` — puts the tip bone of a named chain at `position` (as far as it reaches; straight toward it when out of reach), turned to `quaternion`, every bone within its joint limit, and writes the chain into `current`. A two-segment chain (a limb) bends its middle joint as a hinge, toward `pole` if given, else turned as it is now. The limb turns to a pole at once, so move a pole like any goal (`follow` it) rather than switching it; a near-straight limb, or a goal crossing the line to the pole, swivels fast. To move the body, `setRoot` first.
- `follow(prev2, prev, target, { accel, speed?, velocity? }, dt, out?)` — the next value (a `Vector3` or a number) of something moving toward `target` from its history: velocity changes by at most `accel · dt`, closes in at most at `speed`. Moving straight at a still target (or from rest) it stops on it without passing it, unless too fast to brake in time; velocity across the line to it can carry it past, by up to about 1.25 · v⊥²/`accel`. Pass the goal's own `velocity` to follow a moving goal without lag. It throws on a target or history that is not finite.
- `followRotation(prev2, prev, target, { accel, speed?, velocity? }, dt, out?)` — the same for a quaternion (rad/s, rad/s²), in whatever frame the quaternions are in: world rotations, or a bone's `local` ones (`velocity` an angular velocity in that frame).
- `clampRotation(q, limit)`, `beyond(q, limit)` — a joint's swing–twist limit (`skeleton.limits[bone]`).

Typical: steer a point with `follow` from `prev2`/`prev`, then place it with `solveChain`.

## A humanoid

```ts
import { Quaternion, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { follow, followRotation, Humanoid, INDEX, relaxedPose, solveChain, type Frame } from '@drawcall/animate';

const model = await loadCharacterModel();
scene.add(model.scene);
const goal = new Vector3(-0.3, 1.2, 0.4);
const relaxed = relaxedPose();
const q = new Quaternion();
const body = new Humanoid(
  model,
  () =>
    function* () {
      yield* parallel<Frame>(
        'all',
        // the base: every joint back to the relaxed pose
        action<Frame>({
          update: (f) => {
            for (const { bone, rotation } of relaxed) f.current.setLocal(bone, followRotation(f.prev2.local(bone), f.prev.local(bone), rotation, { accel: 30 }, f.dt, q));
          },
        }),
        // over it: the right hand to the goal
        action<Frame>({
          update: (f) => {
            const hand = follow(f.prev2.position(INDEX.rightHand), f.prev.position(INDEX.rightHand), goal, { accel: 8, speed: 1.5 }, f.dt);
            solveChain(f, 'rightArm', { tip: { position: hand } });
          },
        }),
      );
    },
  { position: { x: 0, z: 0 }, yaw: 0 },
);

// every frame
body.update(delta);
```

`new Humanoid(model, behaviour, { world, position, yaw })`: `behaviour` receives the humanoid and returns the timeline; the body starts standing relaxed, soles on the floor. One Humanoid per model; without a model file, `createSkeletonModel(height)` gives a bare-bones one. Read back `body.pose`, `body.yaw`, `body.velocity`, `body.proportions` and `body.rig.skeleton`.

Bones are the VRM humanoid bones (`BONES`, indices in `INDEX`; normalized: +Y up, facing +Z, left +X, the T-pose is identity). Chains (`CHAINS`): `leftArm`/`rightArm` (upper arm → hand: the wrist), `leftLeg`/`rightLeg` (thigh → foot: the ankle), `spine` (spine → head), `neck` (neck → head). Every joint but the hips has a human range of motion (`ranges()`).

### Several actors

Share one `World` (`createWorld()`). Before updating, set `world.bodies` to each actor's pose as it was (copies: `actor.snapshot()`, or `pose.copy(actor.pose)` into poses you keep), so each body reads the others the same whatever order they update in.

## Any rig

```ts
import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, Skeleton, solveChain, type Frame } from '@drawcall/animate';

const bone = (name: string, parent: number, y: number) => ({ name, parent, offset: new Vector3(0, y, 0), mass: 1, com: new Vector3() });
const skeleton = new Skeleton([bone('base', -1, 0), bone('a', 0, 0.5), bone('b', 1, 0.5), bone('tip', 2, 0.5)], {
  limits: [], // { bone, axis, swing, twist, neutral? } per joint
  chains: { arm: ['a', 'b', 'tip'] },
});
const body = new Body(skeleton, function* () {
  yield* action<Frame>({ update: (f) => solveChain(f, 'arm', { tip: { position: new Vector3(0.3, 0.6, 0) } }) });
});
body.update(delta); // read body.pose
```

Bones are listed parents first, bone 0 the root; rest rotations are identity. Chains list a joint, its descendants down to the tip, each the child of the one before.
