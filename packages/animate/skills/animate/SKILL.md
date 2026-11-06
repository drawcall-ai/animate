---
name: animate
description: Write or review code that moves bodies with @drawcall/animate (`Body`, `walkTo`, `grab`, `lookAt`, stories on `runTimeline`), including custom species, crowds and player-driven bodies. Not for rigging a mesh (@drawcall/rig's skill) or playing baked animation clips.
---

# @drawcall/animate

A story runs on the app's `runTimeline` from @pmndrs/timeline; advance it before updating each body. The body supplies idle motion and balance, so a pause usually needs only `wait`. Units are metres, seconds and radians; +Y is up, +Z forward, +X the body's left.

A mover (`walkTo`, `reach`, `grab`, `carry`, `throwAt`) ends when its goal is met and returns whether it was. An aimer (`lookAt`, `track`, `pose`) runs until it is raced or given an `until`. A verb asks for the body parts it is about and borrows the others it needs, as a grab borrows the legs to walk up and the eyes to find the grips.

## Compose around contact

A grab or carry's outcome is the proof of contact; a time-based `until` ending is not. For a hand-over, give the prop grips for each body, since two hands cannot share one spot; keep the giver carrying while the receiver grabs, confirm the receiver holds it, then release the giver. To start a beat already holding something, `grab` it with `speed: Infinity` as the story starts.

This complete headless example uses the shipped [person skeleton](references/person.ts); copy that file beside your script. The box has constructed grip empties; no model or renderer is required.

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

Use `parallel('all', …)` when every branch must finish, and `'race'` to cancel the rest when one finishes: race an aimer against the sequence that ends it, or a verb against `wait(3)`. Natural motion starts the next task's preparation before the current one ends: the eyes first, then the turn, then the hands. Strict walk-then-look-then-reach reads as mechanical, and a walk ends only once its feet are squared, so what follows it in plain sequence starts from a dead stop. `arriving(body, seconds)` times the overlap; it counts only movers begun once it is made, so make it before or beside the verb it times (for rest, `body.settled`).

A hand verb that may walk (`reach`, `grab`, `carry`) picks where to stand when it starts. So put eyes, poses and hands-up preparation beside a walk on `arriving`, but start a hand verb once its target has come to rest, and after a walk to a mark end that walk on `until: arriving(body, 0.5)` and start the hand verb then. With no particular mark to stand on, skip the `walkTo`: `grab` walks up on its own and already overlaps walking, looking and reaching.

Each body part does one thing at a time. An asked part beats a borrowed one, and a newer asked verb overrides an older one until it ends, so a look beside a grab directs the eyes without interrupting the hands. Inspect `body.owners` when that surprises you.

The two hands are separate parts too, so overlap their verbs as a person does rather than finishing one hand before the other starts: `yield* parallel('all', carry(body, grenade, ready), grab(body, pin, { left: 'ring' }))` brings the ring hand in while the grenade is still coming up.

## Choose the verb by what it is judged on

`reach` takes the hands to a target with a human reach's timing and fails, saying why, when it cannot get there. `track` keeps each hand on a moving target at once, without arriving, and never ends on its own: a clap, a fist pump, XR controllers.

For a nod, a bow, an arched back, a head tilt or a gesture of the arms, use `pose`; `lookAt` says only where the eyes go and how much of the turn the head and trunk take. A pose's head sits on top of the gaze: race a `lookAt` with a head `pose` to tilt a look. The trunk is one part: a `lookAt` given `trunk` and a trunk `pose` take it from each other, the newer winning, so a look restarted in a loop takes it back from a coil you posed. `throwAt` takes the trunk from a running look itself and hands it back after: leave the look running. A pose's arms give way to a hand verb or a held thing, and each part eases in at its own pace, so a short pose comes out smaller. No body kneels, sits or lies down; a pose's `lower` is the nearest to a kneel, and anything further is a puppet (below).

## Hands on props

Give a movable prop its `userData.mass` and named grip empties, and declare on each empty what of the hand's placement is fixed and what is free, describing what the hand touches, not where the wrist goes. A grab fixes what is free as it starts, from where the body stands — the most comfortable wrist, the palm clear of the prop, on a handle the thumb opposing across its narrowest side — and keeps that placement on the prop while it holds it, however the hand came (a hand carrying a prop alone by a grip with freedoms may still turn it in its fingers for where the carry ends); the arm brings the hand there exactly, and a skeleton with finger bones then closes its fingers round the prop's meshes, the fingers never moving the hand. `userData.facing` points from the hand into the prop, the way the touching part (the palm, or a fingertip's pad) faces, so a hand coming at a ring from its +X side gives −X. Leave out what any way round will do; give what the hand must keep: what a grip fixes the arm holds exactly, while what the library picks suits the moment of the grab and is only preferred after it. Choose the grip by what the hand does:

- Laid on a surface (a box's side, a tabletop): a plain empty where the palm's middle goes, the hand turned as the arm brings it; give a facing into the surface where the palm must lie flat on it.
- Round something (a handle, a rung, a rail, a can in the fist, the wire of a ring): `userData.handle`, the line it runs along pointing out of the fist at the thumb's end, the empty on that line, and `radius` for how far the palm's skin lies off it where the meshes do not show it. The hand rolls freely about the line unless a facing fixes it: fix it on anything the hand must hold one way (a weapon's grips), and make sure the wrist reaches that turn from where the body holds it. `userData.length` lets the hand slide along the line (a rail, a rope). A ball held all over: `radius` without a handle, the empty at its middle. To pinch something flat (a magazine, a book), put the handle along an edge, facing onto that edge, or `userData.pad: 'pinch'`.
- A fingertip (a button, a switch): `userData.pad` names the digit, with a facing. One `grab` presses, the finger pointed before its last run in along the facing; `release` draws it back off the face. Make the button a massless thing of its own, its cap's mesh beside it rather than under it (a hand goes round a thing's meshes to its grip), and move it in as it is pressed.
- A digit apart from the rest (a trigger finger, a thumb on a spoon): `userData.fingers` on the grip names an empty its pad goes to, read every update; hang that empty under the part it presses and move the part to move the digit.

```ts
import type { Object3D } from 'three';
declare const pistolGrip: Object3D, button: Object3D, grenadeBody: Object3D, ringEdge: Object3D, aiming: boolean;

Object.assign(pistolGrip.userData, { handle: [0, 1, 0.18], facing: [1, 0, 0.3] }); // palm on the grip's right, thumb up and round its back
Object.assign(button.userData, { pad: 'index', facing: [0, 0, -1] });
pistolGrip.userData.fingers = { index: aiming ? 'trigger' : 'frame' };
Object.assign(grenadeBody.userData, { handle: [0, 1, 0], facing: [0, 0, -1], radius: 0.032 }); // fuze up, the palm over a spoon on its +Z side
Object.assign(ringEdge.userData, { handle: [0, 1, 0], facing: [-1, 0, 0], radius: 0.0015 });  // a ring standing upright (its hole along Z), held by its wire on its +X edge from outside
```

`grab` ends once the fingers have closed, so what follows may pull at once; `reach` and `track` refuse a handle or pad. A hand holding something else lets go of it as `grab` sets off, and a two-handed weapon left by both hands stays wherever its mount holds it, in mid-air if that is where the mount is. So when both hands are needed elsewhere, `orient` its mount to hang the weapon muzzle down and across the body and let go: its muzzle along about (0.3, −0.85, 0.4) in the frame of whatever the mount hangs from (its parent, an empty or a bone; for one on the chest unturned, +X is the body's left, +Y up, +Z ahead), turned the least way onto that line, no extra roll, and slid about 0.2 m down it within the mount (its local position) so the receiver hangs below the chest, where the hands work. `orient` takes the world rotation: that parent's world turn times the hang. Take it back the way a soldier does: turn the mount halfway back, take the support hand's grip, turn it on to the aim, then take the firing hand's; from the full hang, or firing hand first, a hand is held off its grip by its joints. Work on what the hands hold up before the chest, clear of what hangs there.

Hand targets for what a person does about itself (holding something up to look at it, drawing a pin out) come from `body.armPoint(side, direction, share)`, which scales with the body (0.5 of the arm holds something up before the chest, the elbow tucked; 0.75 is a comfortable reach; a first-person view sees the hands' work only up and forward, e.g. direction (0.2, 0.3, 1) at 0.75); give it as a function, `() => body.armPoint(…)`, so it moves with the body. Any verb's target may be such a function of the body's time, returning a point, an object or (for a look) a body. A carry to a point keeps the thing turned as the hand holds it; to turn it too (a grenade's ring toward the other hand, about −45° about the body's up for a right hand with the ring on the grenade's +X side), carry it to an empty turned so, parented to `body.object` so it moves with the body: the carry ends once it is there and turned.

A part of a held thing (a magazine in its rifle, a grenade's pin) is a thing of its own, with its own mass and grips under its parent. The other hand grabs it where it sits and follows it there; `carry` lifts it off into that hand, and a release onto an empty puts it back. To move a part along its parent (a magazine up its well), hold it and move its local position yourself: the hand follows. A worn prop (a sword in its scabbard) comes out along `userData.approach` on the empty it sits in (or goes in along it on the empty it is carried to): on the place, not on a grip.

To throw what one hand holds, `throwAt` it: the body's whole throw, aimed at the target, whose `released` motion you give to your physics. Turn the body toward the target first, and let a two-handed weapon hang (above), since the trunk's coil swings what the other hand holds. It owns the throwing arm and the trunk until its follow-through is done and then ends, about a second in: take the weapon back after it, while the legs step back on their own.

```ts
import { Vector3, type Object3D } from 'three';
import { carry, grab, release, throwAt, type Body } from '@drawcall/animate';
declare function throwInto(thing: Object3D, velocity: Vector3, spin: Vector3): void; // your physics

function* pullAndThrow(soldier: Body, grenade: Object3D, pin: Object3D, target: Vector3) {
  if (!(yield* grab(soldier, grenade, { right: 'body' }))) return false;
  if (!(yield* grab(soldier, pin, { left: 'ring' }))) return false; // the pin: a thing of its own (its own mass) under the grenade
  // (drawn out and let go on the way once clear of the grenade, as a soldier drops it, not waiting to arrive)
  const clear = () => pin.getWorldPosition(new Vector3()).distanceTo(grenade.getWorldPosition(new Vector3())) > 0.08;
  yield* carry(soldier, pin, () => soldier.armPoint('left', new Vector3(1, -0.5, 0.7), 0.75), { step: false, until: clear });
  release(soldier, pin);                                            // left in the world where it is: it falls in your physics
  return yield* throwAt(soldier, grenade, target, { released: ({ velocity, spin }) => throwInto(grenade, velocity, spin) });
}
```

## Puppets

For what no verb does (sitting at a wheel, climbing a ladder), stop updating the body and write its `bones` yourself from its last pose, each hand where `body.gripOn` puts it on a placement and its fingers shaped every frame with `body.shapeHand` on the same placement. Make grip empties wherever a hand holds (each rung, the rim at ten to two) and get each hand's placement on one with `body.placement` once, as the hand sets off for it, keeping it while the hand holds it; or, for exact control, give a `HandPlacement` yourself: the point of the hand, where it goes and how it is turned on the thing, and whether the fingers close on the thing or hold a shape. A body you stop updating keeps its state where it stopped, so to hand it back create a fresh body where it now stands, step it until it has settled and blend from your pose onto it.

## Stories that compose

Write each beat as a generator function (`function* (…): Verb`) that takes the bodies and props it acts on and returns whether it succeeded. Make the bodies, props and marks once, outside every beat; work out marks that depend on where bodies stand inside the story, when the beat reaches them. `yield* parallel('race', …)` returns what the branch that ended it returned, and `'all'` returns `false` if any branch did, so check outcomes on the `parallel` itself. Signal moments other parts of the scene key off (a camera cut when the medal is hung) from the beat after the verb that does it, not by reading `body.owners`, which empties once a race ends.

## Bodies

A bare body and a skinned body use the same skeleton. To skin a mesh, follow the installed `@drawcall/rig` package's skill (`skills/rig/SKILL.md`), and pass the rigged scene as the body's `model` and the skin report as its `mass`. A humanoid's bones take the `HumanoidBone` names (VRM style: `hips`, `leftUpperArm`, …), whatever a rig guide suggests. The skeleton is in model space facing +Z, in metres at real size, since sizes set strides and reach. The [person](references/person.ts), [horse](references/horse.ts), [dog](references/dog.ts) and [lion](references/lion.ts) skeletons are starting points; another height is the person's positions scaled.

Bodies of one size that start together move in sync and read as copies: give each its own `life.seed`, and do not start identical bodies' walks on the same frame. A person at attention takes `life: { steady: 1 }`.

## Places and paths

A point in a body's frame is `body.object.localToWorld(new Vector3(x, y, z))`; an empty parented to `body.object` turns with it. A mark is an empty on the floor where a body is to stand, its +Z the way it should face, at the floor's height. Grips and approach empties belong to the prop, so the same story works with moved furniture. Build hand targets from `body.species.person`'s measures (`armLength`, …), not in metres.

A raised stage, a dais or stairs is the body's `floor` function, the same for every body on the set. Walks the story drives do not handle ramps or shallow treads: use level areas and treads sized for the largest foot in the cast.

Bodies keep their feet clear of each other but do not plan paths around props, and hands and carried things pass through other bodies and props alike: route a carry past a head or a table with waypoints.

## Moving together

To move bodies together (a line abreast, an escort, a horse led), give each the same explicit `speed`: by default bodies of different sizes walk at different paces and string out. To keep a formation on a leader, walk each follower to a target in its own lane (an empty parented to the leader's `object`, or a function of time), ending when the leader arrives; give the followers' speed a little headroom over the shared pace, and start each near its lane, since a lane target behind a follower turns it round. To lead a horse, take the rope first; a tether limits its head's reach but does not make it follow, and the scene draws the rope.

## Many bodies

A body costs about 0.1 ms of CPU a frame (some 120 fit 60 fps in a browser), and `update` always simulates whole 1/60 s ticks, so updating a distant body less often saves nothing. For hundreds, simulate the bodies the camera sees closely and let copies replay a nearby body's pose (its `object`'s transform and its `bones`' local transforms), drawing a block of copies as one skinned mesh over one skeleton. A copy repeats its source's gaze and turns, so vary which body and how many frames behind each copy follows, and keep real bodies where eyes must meet something.

## Players and custom species

Use a body's `drive` for a player-controlled root with procedural legs, and `track` for its headset and controllers; scripted hands and eyes can still act on that body. When a physics controller owns movement, give the body the same world-space `floor` as its colliders, and keep `body.object` under a parent at the world's frame rather than parenting it to a moving platform: the root's `platform` carries it; move the platform before updating the body. When a foot can land on another moving surface, give the floor a `platform(x, z)` method selecting the same surface as the height, for example `Object.assign(heightAt, { platform: bodyAt })`. Do not animate takeoff or landing yourself. For a hit or recoil, `body.applyImpulse` rocks the torso while the hands keep their grips.

To aim something mounted on the body (a rifle on an empty under the chest), call `body.orient(mount, rotation)` before each `update` with the rotation you want, instead of setting its local rotation from the chest as last posed. While the hands work on the mount itself (a magazine swap), release it with `orient(mount, null)` so it rides the chest, then ease back to the aim from the turn it rode at. The body keeps grips within the arms' length but not off the trunk: a turn that brings a grip against the body leaves a hand that returns to it held off it, so bring the mount back toward the aim as the hand returns.

A body's pose changes only once a tick, so a first-person camera on it must blend the body's nodes and the eye between its last two ticks for display, and turn the shown body about the eye to the mouse's current yaw and pitch every rendered frame.

For a custom creature, start from [lion-species.ts](references/lion-species.ts). Every leg must be able to lift and place its foot, even on a creature that never walks. A creature without a `carriage` has no idle life of its own, so give it life from the story with `pose` and `lookAt`. For mouth contact (a horse's or dog's `jaw`), use `reach` with a point. Check a new gait by counting the frames each foot of `body.feet` spends unplanted.

## Check the story

A verb that fails says why only in development: make bodies with `dev: true` while you work on a story and print each new `body.log` entry as it arrives (an app that turns it on only in development, e.g. from `import.meta.env.DEV`, has it off in its tests and builds: run them with `--mode development` or pass `dev: true` there); an entry's `detail` says what limited it and by how much (a hand off its goal: beyond the arm's reach, against the trunk, or held by a joint's range), and `dev: { notes: true }` adds what is only reported, such as each walk-up. Headless runs need a bounded duration and an explicit completion check, as above. Put scene-specific observations in `watch(body, …)` beside the story, raced against its completion. Judge the final pose and actual ownership rather than elapsed time, and whether a body stands on its mark by `body.feet`.
