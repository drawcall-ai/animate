---
name: animate
description: Author or review procedural character motion and stories with @drawcall/animate, using skeletons rigged by @drawcall/rig; includes bare bodies, custom species and player-driven motion.
---

# @drawcall/animate

A story runs on the app's `runTimeline` from @pmndrs/timeline; step it before updating each body. The body supplies idle motion and balance, so a pause usually needs only `wait`, unless you deliberately override that motion. Units are metres, seconds and radians; +Y is up, +Z is forward and +X is the body's left.

## Compose around contact

Check a grab or carry's outcome before starting a dependent action. A time-based `until` ending is not proof of contact. For a hand-over, keep the giver carrying while the receiver grabs, confirm the receiver holds the object, then release the giver: the object changes holder without teleporting.

This complete headless example uses the shipped [person skeleton](references/person.ts). Run it beside this skill, or copy that file alongside your script and adjust the import. The box has constructed grip empties; no model or renderer is required.

```ts
import { Group, Object3D, Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { Body, carry, grab, humanoid, release, wait } from '@drawcall/animate';
import { PERSON } from './references/person';

const giver = new Body(humanoid(PERSON), { dev: true });
const receiver = new Body(humanoid(PERSON), { dev: true, at: new Vector3(0, 0, 1.6), face: Math.PI });
const scene = new Group();
scene.add(giver.object, receiver.object);
const box = new Object3D();
box.name = 'box';
box.userData.mass = 2;
box.position.set(0, 0.9, 0.45);
for (const [name, x] of [['left', 0.15], ['right', -0.15]] as const) {
  const grip = new Object3D();
  grip.name = name;
  grip.position.x = x;
  box.add(grip);
}
const shelf = new Object3D();
shelf.name = 'shelf';
shelf.position.set(0.8, 1, 1.2);
scene.add(box, shelf);
scene.updateMatrixWorld(true);

let finished = false;
const updateStory = runTimeline(function* () {
  if (!(yield* grab(giver, box, { left: 'left', right: 'right' }))) throw new Error('Giver could not grab the box');
  yield* parallel('race', carry(giver, box, new Vector3(0, 1.05, 0.8), { until: Infinity }), function* () {
    yield* wait(1.5); // lets the offer begin; acquisition below, not this delay, authorizes release
    if (!(yield* grab(receiver, box, { left: 'right', right: 'left' }))) throw new Error('Receiver could not grab the box');
    if (!receiver.holds(box)) throw new Error('Receiver has no contact');
  });
  release(giver, box);
  if (!(yield* carry(receiver, box, shelf))) throw new Error('Receiver could not reach the shelf');
  release(receiver, box, shelf);
  finished = true;
});
for (let frame = 0; frame < 20 * 60 && !finished; frame++) {
  updateStory(undefined, 1 / 60);
  giver.update(1 / 60);
  receiver.update(1 / 60);
}
if (!finished) throw new Error('Story did not finish within 20 seconds');
if (giver.holds(box) || receiver.holds(box) || box.parent !== shelf) throw new Error('Box was not placed');
if (giver.log.length || receiver.log.length) throw new Error(JSON.stringify([...giver.log, ...receiver.log]));
```

Use `parallel('all', …)` when every branch must finish, and `'race'` to cancel the rest when one finishes. Race endless aimers such as `lookAt` or a sustained carry against the sequence that ends them. To anticipate the next task, start its preparation beside the current task with `parallel` and `arriving`; strict walk-then-look-then-reach sequences read as mechanical. Grab already overlaps its own walking, looking and reaching; low reaches and grabs recruit crouching automatically as needed.

Each body part does one thing at a time. An asked verb beats a borrowed part; a newer asked verb overrides an older one until it ends. Thus a look beside a grab directs the eyes without interrupting the hands. Inspect `body.owners` when that composition surprises you.

## Bodies and places

A bare body and a skinned body use the same skeleton. For a mesh, resolve the installed `@drawcall/rig` package and read its `skills/rig/SKILL.md` to author the skeleton and bind it with `skin`. The reference [person](references/person.ts), [horse](references/horse.ts), [dog](references/dog.ts) and [lion](references/lion.ts) skeletons are starting points; mesh positions must fit the mesh. The lion skeleton also needs custom roles and tuning.

Targets are scene points, objects or functions returning them. Use a point when only position matters; a scene empty also supplies orientation and follows its parent. Turn a placement empty's +Z toward the direction the body should face there. Grips and approach empties belong to the prop, so the same story can work with moved furniture. The body avoids other bodies, but does not plan paths around props.

Give movable props their mass and named grips. Taking hold of a worn object leaves it attached until carrying starts; this lets a hand find a sword before drawing it. Approaches describe the path out of or into a placement. Creature carry rejects multiple waypoints, nonempty approach routes and placement speed metadata; use a single target and verb pace options.

To lead a horse, take the rope, then walk both bodies in parallel with the horse targeting an empty in its lane beside and behind the leader. End following when the leader arrives; on a straight route, do not move the empty behind its starting position. A tether limits head reach but does not make the horse follow; the scene owns the visible rope.

## Players and custom species

Use `track` for headset and controller targets, or a body's `drive` for a player-controlled root with procedural legs. Scripted hands and eyes can still act on that body. The built-in creatures have no sitting or lying action; a stopped dog stands.

For a custom creature, combine a skeleton with `species`, roles and tuning. Assign chains to the jobs they perform, then choose gait and mass distribution for that anatomy. The types at `@drawcall/animate/species` describe the inputs; its gait helpers compose footfall timing and carriage, and `swing` can supply tail life. A hand is a chain tip: the horse and dog expose `jaw`; use `reach` for mouth contact, not `lookAt`, which directs gaze. Creature hands operate one at a time. Leave spare leg reach with the sole flat after gait lowering; an extended rest chain may have no room to move.

## Check the story

Use dev-enabled bodies and inspect their logs and notes alongside verb outcomes. An unreachable reach ends false; headless runs still need a bounded duration and an explicit completion check, as above. Put scene-specific observations in `watch(body, …)` beside the story, raced against its completion. Check the final pose and actual object ownership rather than treating elapsed time as success.
