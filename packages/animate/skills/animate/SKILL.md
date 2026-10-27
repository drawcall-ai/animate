---
name: animate
description: Make three.js characters and creatures move procedurally, without animation clips — people, horses, dogs or any creature with a rigged skeleton walking, looking, reaching, picking things up, carrying, handing over and putting down, scripted as stories or driven by a player or a VR headset — with @drawcall/animate. Use when a three.js scene needs a character or animal to walk somewhere, pick up or carry an object, follow a player's controls, or move on a species built from a skeleton, and when writing or reviewing code that imports @drawcall/animate.
---

# @drawcall/animate

## The model

A story is any `function*` your app runs with `runTimeline` from @pmndrs/timeline. Verbs are generators: `yield* walkTo(body, target)` runs one to its end and returns `true` once its goal is met, `false` once it cannot be (no stand reaches the grips, the walk stalled). `parallel('all' | 'race', …)` runs verbs and generators at once; `wait(seconds | () => boolean)` waits. Every verb but `release` takes `until` (seconds, a condition or `Infinity`), which ends it `true` whatever its goal. `release` is instant: call it without `yield*`.

The story decides once per frame; the motion runs in fixed 1/60 s sub-steps inside `body.update` and never waits on the story. Units are metres, seconds and radians; +Y is up, the floor is y = 0, a facing of 0 looks along +Z, with +X then the body's left. A target is a `Vector3` (a point), an `Object3D` (it moves with its parent and also sets the orientation: an empty, a bone, `body.bones.head`) or a function of the body's time returning either.

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { skin } from '@drawcall/rig';
import { arriving, Body, carry, grab, humanoid, lookAt, release, wait, walkTo, watch } from '@drawcall/animate';

const model = (await new GLTFLoader().loadAsync('person.glb')).scene;
// one SkeletonBone per bone, written for this mesh (rig's skill says how); `as const` checks the bone names
const skeleton = [/* { name: 'hips', position: [0, 0.95, 0] }, { name: 'spine', parent: 'hips', position: [0, 1.05, 0] }, … */] as const;
await skin(model, skeleton);
const person = new Body(humanoid(skeleton), { model, dev: true });
scene.add(person.object); // under an untransformed parent; the body moves it

const box = scene.getObjectByName('box')!;           // userData.mass = 2, empties named 'left' and 'right' on its sides
const shelfTop = scene.getObjectByName('shelfTop')!; // an empty, +Z the way the person faces setting the box there
const door = scene.getObjectByName('door')!, lamp = scene.getObjectByName('lamp')!;
const updateStory = runTimeline(function* () {
  yield* parallel('race', function* () {
    yield* grab(person, box, { left: 'left', right: 'right' }); // walks up, eyes first, hands rising before it arrives
    yield* parallel('all', carry(person, box, shelfTop), function* () {
      yield* wait(arriving(person, 1));                          // the next thing starts before this one ends
      yield* lookAt(person, door, { until: 1.5 });
    });
    release(person, box, shelfTop);                              // attached to the shelf, exactly there
    yield* walkTo(person, door);
  }, watch(person, 'clear of the lamp', () => {
    const distance = person.position.distanceTo(lamp.position);
    return distance < 0.4 ? { check: 'distance (m)', value: distance, limit: 0.4, where: 'root' } : null;
  }));
});

renderer.setAnimationLoop(() => {
  const seconds = clock.getDelta();
  updateStory(undefined, seconds);
  person.update(seconds); // several bodies read each other as they were before this frame: update them in any order
});
```

## Bodies

A body is a species of a skeleton: `humanoid(skeleton)`, `horse(skeleton)`, `dog(skeleton)` or `species(skeleton, roles, tuning)`, the skeleton being @drawcall/rig's `SkeletonBone[]` (see `node_modules/@drawcall/rig/skills/rig/SKILL.md` for writing one and rigging a mesh with `skin`). With `model` the body drives the rig's bound bones by name; without it the body is bare, for tests and headless runs. The options and the state a body reports are documented on `BodyOptions` and `Body`.

## What a body does by itself, and what a story asks

A person balances, breathes, sways, shifts its weight, swings its free arms and looks about by itself, seeded; a creature stands, glances and swishes its tail. Never author any of that: to stand a while, `wait`.

Each part of a body (its legs, eyes, trunk and each hand) does one thing at a time. A verb asks for the parts it is about (`walkTo` the legs, `lookAt` the eyes, `grab` the hands) and borrows the rest it needs (`grab` borrows the legs to walk up and the eyes to find the grips). The newest asked verb takes a part; when it ends, the one it overrode takes the part back from where it is, so nothing snaps. Anything asked beats anything borrowed, and among borrowers the first keeps the legs. So run things side by side freely: a `lookAt` over a `grab` takes only the eyes. `body.owners` says which verb holds each part when a scene does something unexpected.

People look at, turn to and reach for the next thing while still finishing the last; tasks strictly one after another read as mechanical. Start the next thing in `parallel('all', …)` with the end of the current one, on `arriving(body, seconds)`. The verbs overlap their own parts already: `grab` walks, looks and reaches at once, so do not walk up and look first yourself. Hand things over on conditions, never on time.

## Things

A thing is any `Object3D`. `userData.mass` (kg) makes it movable, and the body slows and prepares for it: give the mass instead of slowing anything yourself. Grips are named empties under the thing (`{ right: 'handle' }`; the thing's own name is its origin). An empty that things are put onto or taken from may name its `userData.approach` (empties beside it, outermost first: a shelf's front edge, a scabbard's way out) and `userData.speed` (m/s on the last straight); `carry` comes in, and goes out, that way.

Turn a place's empty so its +Z is the way the body should face as it sets the thing there; which grip each hand takes then picks the side it stands on. The body keeps clear of other bodies, never of props: where it stands is what the scene's places and empties say.

A thing moves with its scene-graph parent, and the verbs re-parent it:
- `grab` never takes a thing off what it is attached to. A loose thing with mass (on no body) is lifted clear and drawn in; anything else stays where it is and the hands follow it (a sword in its scabbard, a door handle).
- `carry` moves what is held to a target or through a list of targets (off its hip or pouch first, out the way its empty's approach comes in, walking there if it must, in by the target's approach) and keeps it there.
- `release(body, thing, onto?)` attaches it onto the empty `onto` (exactly there within 5 mm), else to another body still holding it (a hand-over), else back to the parent it was taken from, where it is. `release(body, { right: thing })` lets go with the hands named. The hands that let go back out of it, carrying on the way they were going.
- What a body wears is whatever its bones carry in the scene graph: add a thing under `body.bones.hips` and the body bears its weight.

`grab`, `reach` and `carry` stand where the grips are in comfortable reach, facing them squarely, or work from where the body stands when they are in reach. What you author is the scene: its places and empties, the order of beats, and the pauses.

## Gaze, tracking and players

`lookAt(body, target, { trunk, until })` keeps the eyes on a target (with `trunk`, the trunk turns with them, as an aim does); it never ends by itself, so give it `until` in a sequence or race it. `track(person, { head, left, right })` follows a headset and controllers. `drive` (in the body's options) hands a person's root to a player's controller each sub-step: nothing borrows a driven body's legs (`walkTo` throws for it), but its hands, eyes and trunk take any verb.

## Creatures of your own

`species(skeleton, roles, tuning)` makes any creature from its skeleton: `roles` says what the bones do and `tuning` gives its numbers (both documented on `Roles` and `Tuning`); `@drawcall/animate/species` holds the gaits and parts a species needs. A creature's hand is the tip of its chain: `grab` walks it up until the grip is in reach and the chain takes it, one hand at a time.

```ts
const bird = species(BIRD, {
  legs: (['left', 'right'] as const).map((side) => ({
    joints: [{ bone: `${side}Hip`, axes: 'yzx' }, { bone: `${side}Knee`, axes: 'x' }, { bone: `${side}Ankle`, axes: 'x' }, { bone: `${side}Toe`, axes: 'zx' }],
    heel: [0, -0.02, -0.02], toe: [0, -0.02, 0.04],
  })),
  hands: { beak: ['neck', 'beak'] },
}, {
  gait: powerGait({ height: 0.26, slowest: 0.2, offsets: [0, 0.5], stride: 2, stance: 0.9, clearance: [0.02, 0.02] }),
  masses: { body: 0.7, neck: 0.04, beak: 0.02 /* … every bone that weighs something */ },
});
```

## Checking

Develop with `{ dev: true }` on every body. Every sub-step then checks the final pose (joint ranges and speeds, planted feet, balance, the hands on what they hold) and the scene (a thing let go in mid-air, put onto an empty far off it or taken, re-parented under a hand by something else; a story that stopped stepping its verbs) and appends each problem to `body.log` with its time and the verbs running. Lateness never throws: a reach or carry still short of its goal adds one entry and keeps going, and a goal nothing can reach ends its verb `false`. A body throws only for misuse (a grip that does not exist, carrying what no hand holds, a hand it does not have), the error carrying the time and verbs. So test stories with dev on, and assert the outcomes, that the story finished and that `body.log` is empty. A scene's own expectations are `watch(body, label, check)` beside the story, as in the example.
