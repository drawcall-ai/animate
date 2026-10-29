---
name: animate
description: Write or review code that moves bodies with @drawcall/animate (`Body`, `walkTo`, `grab`, `lookAt`, stories on `runTimeline`), including custom species, crowds and player-driven bodies. Not for rigging a mesh (@drawcall/rig's skill) or playing baked animation clips.
---

# @drawcall/animate

A story runs on the app's `runTimeline` from @pmndrs/timeline; advance it before updating each body. The body supplies idle motion and balance, so a pause usually needs only `wait`. Units are metres, seconds and radians; +Y is up, +Z is forward and +X is the body's left.

Verbs come in two kinds. A mover (`walkTo`, `reach`, `grab`, `carry`) ends when its goal is met and returns whether it was. An aimer (`lookAt`, `track`, `pose`) runs until it is raced or given an `until`. A verb asks for the body parts it is about and borrows the others it needs, as a grab borrows the legs to walk up and the eyes to find the grips.

## Compose around contact

A grab or carry's outcome is the proof of contact; a time-based `until` ending is not. For a hand-over, give the prop grips for each body, since two hands cannot share one spot; keep the giver carrying while the receiver grabs, confirm the receiver holds it, then release the giver, so the prop changes holder without teleporting. To start a beat
already holding something, `grab` it with `speed: Infinity` as the story starts: the hands are on grips in reach at once.

This complete headless example uses the shipped [person skeleton](references/person.ts). Run it beside this skill, or copy that file alongside your script and adjust the import. The box has constructed grip empties; no model or renderer is required.

```ts
import { Group, Object3D, Vector3 } from 'three';
import { parallel, runTimeline } from '@pmndrs/timeline';
import { arriving, Body, carry, grab, humanoid, release, wait } from '@drawcall/animate';
import { PERSON } from './references/person';

const giver = new Body(humanoid(PERSON), { dev: true });
const receiver = new Body(humanoid(PERSON), { dev: true, at: new Vector3(0, 0, 1.6), face: Math.PI });
const scene = new Group();
scene.add(giver.object, receiver.object);
const box = new Object3D();
box.name = 'box';
box.userData.mass = 2;
box.position.set(0, 0.9, 0.45);
// (where each palm closes: the giver's at the box's sides, the receiver's beside them by its own end; facing the giver, its left is the
// giver's right)
for (const [name, x, z] of [['left', 0.15, 0], ['right', -0.15, 0], ['receiver left', -0.15, 0.08], ['receiver right', 0.15, 0.08]] as const) {
  const grip = new Object3D();
  grip.name = name;
  grip.position.set(x, 0, z);
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
    yield* wait(arriving(giver, 0)); // the offer at rest; acquisition below, not this wait, authorizes release
    if (!(yield* grab(receiver, box, { left: 'receiver left', right: 'receiver right' }))) throw new Error('Receiver could not grab the box');
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

## Overlap the tasks

Use `parallel('all', …)` when every branch must finish, and `'race'` to cancel the rest when one finishes; race an aimer against the sequence that ends it, or a verb against `wait(3)` to stop it at three seconds if it has not ended. Natural motion starts the next task's preparation before the current one ends: the eyes go first, then the turn, then the hands. Strict walk-then-look-then-reach sequences read as mechanical, and a walk ends only once its feet are squared, so what follows it in plain sequence starts from a dead stop. `arriving(body, seconds)` times the overlap; it counts only movers begun once it is made, so make it before or beside the verb it times (for rest, `body.settled`).

A hand verb that may walk (`reach`, `grab`, `carry`) picks where to stand when it starts, from where the feet and its target are then. So put eyes, poses and hands-up preparation beside a walk on `arriving`, but start a hand verb once its target has come to rest, and after a walk to a mark end that walk itself on `until: arriving(body, 0.5)` and start the hand verb then. With no particular mark to stand on, skip the `walkTo`: `grab` walks up on its own and already overlaps its walking, looking and reaching. Pass `step: false` to keep the feet where they stand; the verb then ends `false` when the arms and trunk cannot get there. With `dev: { notes: true }`, `body.notes` records each walk-up.

Each body part does one thing at a time. An asked part beats a borrowed one, and a newer asked verb overrides an older one until it ends, so a look beside a grab directs the eyes without interrupting the hands. Inspect `body.owners` when that surprises you.

## Choose the verb by what it is judged on

`reach` takes the hands to a target with a human reach's timing and is judged on getting there: it fails, saying why, when it cannot. `track` keeps each hand on a moving target at once, without arriving, and never ends on its own; it serves a clap or a fist pump as well as XR controllers, within `armLength` of the shoulder (`body.species.person` has it and the other measures: build hand targets from them, not in metres).

For a nod, a bow, an arched back, a head tilt or a gesture of the arms (raised, spread, a wave), use `pose`; `lookAt` says only where the eyes go, and how much of the turn the head and trunk take (`head`, `trunk`: 0…1 shares; `head: 0.3` follows someone mostly with the eyes). A pose's head sits on top of the gaze: race a `lookAt` with a head `pose` to tilt a look. A trunk pose competes with a `lookAt` given `trunk`, and a pose's arms give way to a hand verb or a held thing. Each part eases in at its own pace, so a short pose comes out smaller (dev notes say so). A look's target may be a function returning a point, object or body, for a changing focus. No body kneels, sits or lies down, and a stopped dog stands; a pose's `lower` is the nearest to a kneel.

## Stories that compose

Write each beat as a generator function (`function* (…): Verb`) that takes the bodies and props it acts on and returns whether it succeeded. Make the bodies, props and marks once, outside every beat: a beat that builds its own cast, or works out its marks from where the bodies stand when it is set up, cannot follow another beat that has moved them, so work out such marks inside the story, when the beat reaches them. `yield* parallel('race', …)` returns what the branch that ended it returned, and `'all'` returns `false` if any branch returned `false`, so check a branch's outcome on the `parallel` itself rather than through a variable. When other parts of the scene key off a moment (a camera cut when the medal is hung), signal it from the beat with a callback or flag after the verb that does it, rather than reading `body.owners`, which empties once a race ends.

## Bodies

A bare body and a skinned body use the same skeleton. To skin a mesh, follow the installed `@drawcall/rig` package's skill (`skills/rig/SKILL.md`), pass the rigged scene as the body's `model`, and pass the skin report as its `mass`. A humanoid's bones take the `HumanoidBone` names (VRM style: `hips`, `leftUpperArm`, …), whatever naming a rig guide suggests. The skeleton is in model space with the body facing +Z, in metres at its real size, since sizes set strides and reach; bake a model's facing and size into its mesh before rigging. The reference [person](references/person.ts), [horse](references/horse.ts), [dog](references/dog.ts) and [lion](references/lion.ts) skeletons are starting points; a person of another height is the person skeleton's positions scaled.

Natural motion has variation: bodies of one size that start together move in sync, which reads as copies. Give each body its own `life.seed`, and avoid starting identical bodies' walks on the same frame. A person at attention (a guard, a soldier in rank) takes `life: { steady: 1 }`.

## Places and paths

A point in a body's frame as it stands is `body.object.localToWorld(new Vector3(x, y, z))`; an empty parented to `body.object` turns with it. A mark is an empty on the floor where a body is to stand, its +Z turned the way the body should face; give it the floor's height, `floor(x, z)`, or the dev log says it is off the floor. Grips and approach empties belong to the prop, so the same story works with moved furniture.

A raised stage, a dais or stairs is the body's `floor` function, the same for every body on the set. Ramps and ordinary shallow stairs are not handled: stage the action on level areas and deep treads, sized for the largest foot in the cast (`species.person.heelBack + toeFront`).

A thing held before the body is comfortable where a walking carry holds it, for the default person about 0.35 m ahead of the hips and 0.12 m above hip height; short arms want it nearer the shoulders. Bodies keep their feet clear of each other but do not plan paths around props, and hands and carried things pass through other bodies and props alike: route a carry past a head or a table with waypoints.

## Moving together

To move bodies together (a line abreast, an escort, a horse led), give each the same explicit `speed`: left to their defaults, bodies of different sizes walk and climb at different paces and string out, and people of different heights fall out of sync on their own, as they should. A shared speed keeps every difference in start time or place as a gap, so start bodies level and stagger only look-alikes. To keep a formation on a leader, walk each follower to a target in its own lane (an empty parented to the leader's `object`, or a function of time moving at the shared pace), ending when the leader arrives. A walk to a moving target catches up at its `speed` and then matches the target's velocity, so give that speed a little headroom over the shared pace and start each body near its lane; a lane target behind where its follower starts turns the follower round. To lead a horse, take the rope first; a tether limits its head's reach but does not make it follow, and the scene draws the visible rope.

Give movable props their mass and named grips. A person holds a grip in its palm: put the empty where the hand closes on the prop (on a handle or ribbon, a hand's half-thickness out from a box's side), never where the wrist would be, and the wrist stays a palm's length back from it along the hand. A hand can take hold of a worn prop (a sword in its scabbard) before carrying draws it.

## Many bodies

A body costs about 0.1 ms of CPU a frame (some 120 fit 60 fps in a browser), and `update` always simulates whole 1/60 s ticks, so updating a distant body less often saves nothing. For hundreds, simulate the bodies the camera sees closely and let copies replay a nearby body's pose: its `object`'s transform and its `bones`' local positions and quaternions. Cloned skinned models cost three.js ~13 ms a frame per few hundred in bone updates, so draw a block of copies as one skinned mesh over one skeleton, its bone matrices written from the sources' stored poses. A copy repeats its source's gaze, hands and turns, so far copies face parallel to their source; vary which body and how many frames behind each copy follows, and keep real bodies where eyes must meet something or facings converge.

## Players and custom species

Use a body's `drive` for a player-controlled root with procedural legs, and `track` for its headset and controllers; scripted hands and eyes can still act on that body.

For a custom creature, combine a skeleton with `species(skeleton, roles, tuning)`; [lion-species.ts](references/lion-species.ts) is a complete four-legged species to start from; a species may have two legs or four, and only four carry a `carriage`. Every leg must be able to lift and place its foot, even on a creature that never walks (`LegRole` says what that takes). A creature without a `carriage` has no idle life of its own, so give it life from the story: `pose` for its trunk and `lookAt` for its head. For mouth contact (a horse's or dog's `jaw`), use `reach` with a point, not `lookAt`, which directs gaze. Check a new gait by counting the frames each foot of `body.feet` spends unplanted (`powerGait` says why).

## Check the story

Use dev-enabled bodies and inspect their logs and notes alongside verb outcomes; an entry's `detail` says what limited it and by how much. Headless runs need a bounded duration and an explicit completion check, as above. Put scene-specific observations in `watch(body, …)` beside the story, raced against its completion. Check the final pose and actual ownership rather than treating elapsed time as success, and judge whether a body stands on its mark by `body.feet`.
