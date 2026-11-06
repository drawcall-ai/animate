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

For a nod, a bow, an arched back, a head tilt or a gesture of the arms (raised, spread, a wave), use `pose`; `lookAt` says only where the eyes go, and how much of the turn the head and trunk take (`head`, `trunk`: 0…1 shares; `head: 0.3` follows someone mostly with the eyes). A pose's head sits on top of the gaze: race a `lookAt` with a head `pose` to tilt a look. The trunk is one part: a `lookAt` given `trunk` and a trunk `pose` take it from each other, the newer winning, so a look restarted in a loop takes it back from a coil you posed; pause that look while the pose works. A pose's arms give way to a hand verb or a held thing. Each part eases in at its own pace, so a short pose comes out smaller (dev notes say so). A look's target may be a function returning a point, object or body, for a changing focus. No body kneels, sits or lies down, and a stopped dog stands; a pose's `lower` is the nearest to a kneel, and anything further is a puppet (below).

## Hands on props

Give a movable prop its `userData.mass` and named grip empties, and describe on each empty what the hand touches, not where the wrist goes: the hand and arm are solved from it, and a person whose skeleton has finger bones (see `humanoid`) also closes its fingers round the prop's meshes there. The same prop works for a person with or without finger bones. `userData.facing` always points from the hand into the prop: the way the touching part (the palm, or a fingertip's pad) faces, so a hand coming at a ring from its +X side gives −X. Leave it out where any way round will do (a ball). Choose the grip by what the hand does:

- Laid on a surface (a box's side, a tabletop): a plain empty where the palm's middle goes, a hand's half-thickness out from the surface — never where the wrist would be. Without a facing the hand comes as the arm brings it and the grasp keeps it so.
- Round something (a handle, a bar, a rung, a ball or can in the fist, the wire of a ring): `userData.handle`, the line it runs along pointing out of the fist at the thumb's end, with the empty on that line where the palm's middle closes on it, and `radius` for a thin wire or a ball (a ball's line runs through its middle). Round all over, any facing is right: give the one the arm reaches most easily, the palm toward the body's middle for something held before it. A ring or loop the hand pulls is a handle along its wire at the edge it pulls by; the fingers past the wire's ends fold into the palm. To pinch something flat across its thickness (a magazine, a book), put the handle along an edge, facing onto that edge.
- A fingertip (a button, a switch): `userData.pad` names the digit, with a facing. One `grab` presses; `release` draws it back off the face, and a hand verb that follows waits until it has.
- A digit apart from the rest (a trigger finger, a thumb on a spoon): `userData.fingers` on the grip, naming for that digit an empty its pad goes to, read every update. Hang that empty under the part it presses and move the part to move the digit.

```ts
Object.assign(pistolGrip.userData, { handle: [0, 1, 0.18], facing: [1, 0, 0.3] }); // palm on the grip's right, thumb up and round its back
Object.assign(button.userData, { pad: 'index', facing: [0, 0, -1] });
pistolGrip.userData.fingers = { index: aiming ? 'trigger' : 'frame' };
```

```ts
Object.assign(grenadeBody.userData, { handle: [0, 1, 0], radius: 0.032 });                  // a 6.4 cm ball in the fist, fuze up
Object.assign(ringEdge.userData, { handle: [0, 1, 0], facing: [-1, 0, 0], radius: 0.0015 });  // a ring's wire on its +X edge, hooked from outside
```

`grab` ends once the fingers have closed, so what follows it may pull at once. A hand that holds something else lets go of it as `grab` sets off: a two-handed weapon left by both hands stays wherever its mount holds it, in mid-air if that is where the mount is, so when both hands are needed elsewhere sling it first — `release` it onto an empty on the body (a sling point on the back or hip) — or keep one hand on it. Take it back the way a soldier does: the support hand first (on a rifle, the front grip), bring it up toward the aim, then the firing hand; a firing hand going first reaches for a grip against the trunk and is held off it. Make a button a massless thing of its own, its cap's mesh beside it rather than under it (a hand goes round a thing's meshes to its grip), and move the thing in as it is pressed. `reach` and `track` refuse a handle or pad, whose empty is not where the wrist goes; take it with `grab`.

Hand targets for what a person does about itself (holding something up to look at it, drawing a pin out) come out of `body.armPoint(side, direction, share)`, which scales with the body; give it as a function target, `() => body.armPoint(…)`, so it moves with the body. Any verb's target may be such a function of the body's time returning a point or an object. A carry whose thing stops short of its target (the arm's joints holding it off) ends `false` a moment later, saying so in development.

A part of a held thing (a magazine in its rifle, a grenade's pin) is a thing of its own: give it its own mass and grips under its parent. The other hand grabs it where it sits, leaving it in place and following it; `carry` lifts it off into that hand, and a release onto an empty puts it back. To move a part along its parent (a magazine up its well), hold it with `grab` and move its local position yourself: the hand follows it.

To throw what one hand holds, `throwAt` it: the throw is the body's whole motion, cocked, whipped and followed through, aimed at the target. Turn the body toward the target first, and sling what the other hand holds: the trunk's coil swings whatever is mounted on the chest. A body whose root you drive steps into the throw only as you move its root, about half a stride forward over the whip. Its `released` callback gives the velocity aimed at the target and the hand's spin as the thing leaves the hand, left in the world where it was let go; give them to your physics. `release` also returns how a thing was moving, for one simply let go of on the way of a carry.

```ts
yield* grab(soldier, grenade, { right: 'body' });
yield* grab(soldier, pin, { left: 'ring' });               // the pin: a thing of its own (its own mass) under the grenade
yield* carry(soldier, pin, () => soldier.armPoint('left', new Vector3(1, -0.5, 0.7), 0.85), { step: false });
release(soldier, pin);                                     // left in the world where it is: it falls in your physics
yield* throwAt(soldier, grenade, target, { released: ({ velocity, spin }) => throwInto(physics, grenade, velocity, spin) });
```

## Puppets

For what no verb does (sitting at a wheel, climbing a ladder), stop updating the body and write its `bones` yourself, starting from its last pose. Put each hand where `body.gripOn(side, empty)` says: the wrist, and the world rotation to give the hand bone, as a grab would hold that grip. After posing, call `body.shapeHand(side, to, seconds)` every frame with the grip the hand is on or on its way to (it opens on the way and closes once the wrist is there), a `Fingers` shape, or `null` for relaxed. Make grip empties wherever a hand holds (each rung, the rim at ten to two), parented to what they belong to. A body you stop updating keeps its internal state where it stopped, so to hand it back create a fresh body where it now stands, step it until it has settled and blend from your pose onto the fresh body's.

## Stories that compose

Write each beat as a generator function (`function* (…): Verb`) that takes the bodies and props it acts on and returns whether it succeeded. Make the bodies, props and marks once, outside every beat: a beat that builds its own cast, or works out its marks from where the bodies stand when it is set up, cannot follow another beat that has moved them, so work out such marks inside the story, when the beat reaches them. `yield* parallel('race', …)` returns what the branch that ended it returned, and `'all'` returns `false` if any branch returned `false`, so check a branch's outcome on the `parallel` itself rather than through a variable. When other parts of the scene key off a moment (a camera cut when the medal is hung), signal it from the beat with a callback or flag after the verb that does it, rather than reading `body.owners`, which empties once a race ends.

## Bodies

A bare body and a skinned body use the same skeleton. To skin a mesh, follow the installed `@drawcall/rig` package's skill (`skills/rig/SKILL.md`), pass the rigged scene as the body's `model`, and pass the skin report as its `mass`. A humanoid's bones take the `HumanoidBone` names (VRM style: `hips`, `leftUpperArm`, …), whatever naming a rig guide suggests. The skeleton is in model space with the body facing +Z, in metres at its real size, since sizes set strides and reach; bake a model's facing and size into its mesh before rigging. The reference [person](references/person.ts), [horse](references/horse.ts), [dog](references/dog.ts) and [lion](references/lion.ts) skeletons are starting points; a person of another height is the person skeleton's positions scaled.

Natural motion has variation: bodies of one size that start together move in sync, which reads as copies. Give each body its own `life.seed`, and avoid starting identical bodies' walks on the same frame. A person at attention (a guard, a soldier in rank) takes `life: { steady: 1 }`.

## Places and paths

A point in a body's frame as it stands is `body.object.localToWorld(new Vector3(x, y, z))`; an empty parented to `body.object` turns with it. A mark is an empty on the floor where a body is to stand, its +Z turned the way the body should face; give it the floor's height, `floor(x, z)`, or the dev log says it is off the floor. Grips and approach empties belong to the prop, so the same story works with moved furniture.

A raised stage, a dais or stairs is the body's `floor` function, the same for every body on the set. For walks the story drives, ramps and shallow treads are not handled: use level areas and treads sized for the largest foot in the cast (`species.person.heelBack + toeFront`). A physics `drive` (below) carries the body over ramps and stairs, but a height-only floor leaves soles untilted on slopes.

A thing held before the body is comfortable where a walking carry holds it, for the default person about 0.35 m ahead of the hips and 0.12 m above hip height; short arms want it nearer the shoulders. Bodies keep their feet clear of each other but do not plan paths around props, and hands and carried things pass through other bodies and props alike: route a carry past a head or a table with waypoints.

## Moving together

To move bodies together (a line abreast, an escort, a horse led), give each the same explicit `speed`: left to their defaults, bodies of different sizes walk and climb at different paces and string out, and people of different heights fall out of sync on their own, as they should. A shared speed keeps every difference in start time or place as a gap, so start bodies level and stagger only look-alikes. To keep a formation on a leader, walk each follower to a target in its own lane (an empty parented to the leader's `object`, or a function of time moving at the shared pace), ending when the leader arrives. A walk to a moving target catches up at its `speed` and then matches the target's velocity, so give that speed a little headroom over the shared pace and start each body near its lane; a lane target behind where its follower starts turns the follower round. To lead a horse, take the rope first; a tether limits its head's reach but does not make it follow, and the scene draws the visible rope.

A hand can take hold of a worn prop (a sword in its scabbard) before carrying draws it. A prop held in one hand turns with the hand, and a carry whose end the arm cannot hold it at as taken regrips it in the fingers on the way.

## Many bodies

A body costs about 0.1 ms of CPU a frame (some 120 fit 60 fps in a browser), and `update` always simulates whole 1/60 s ticks, so updating a distant body less often saves nothing. For hundreds, simulate the bodies the camera sees closely and let copies replay a nearby body's pose: its `object`'s transform and its `bones`' local positions and quaternions. Cloned skinned models cost three.js ~13 ms a frame per few hundred in bone updates, so draw a block of copies as one skinned mesh over one skeleton, its bone matrices written from the sources' stored poses. A copy repeats its source's gaze, hands and turns, so far copies face parallel to their source; vary which body and how many frames behind each copy follows, and keep real bodies where eyes must meet something or facings converge.

## Players and custom species

Use a body's `drive` for a player-controlled root with procedural legs, and `track` for its headset and controllers; scripted hands and eyes can still act on that body.

When a physics controller owns movement, return its feet position, velocity relative to its supporting platform, yaw and `support` from `drive`, and give the body the same world-space `floor` as its colliders. Set `support` to the actual world-space physics contact point, or `null` in flight. For a moving support, also return its `Object3D` as `platform`; move it before updating the body. Do not parent `body.object` to the platform; keep it under a parent at the world's frame, and `platform` carries it. When a foot can land on a different moving surface, give the callable `floor` a `platform(x, z)` method returning the object under that point (`undefined` for world-fixed ground), for example `const floor: Floor = Object.assign(heightAt, { platform: bodyAt });`. Both queries must select the same surface. Do not animate takeoff or landing yourself: the legs tuck in flight and absorb the actual landing.

To aim something mounted on the body (a rifle on an empty under the chest) at a world rotation, call `body.orient(mount, rotation)` before each `update` instead of setting the mount's local rotation from the chest as it was posed last: the chest turns within the update, and the hands take hold of the mount as it ends up. Ask the rotation you want (a rifle: the view's): where the trunk has not yet come round, the body turns the mount back only as far as brings the hands' grips within reach, so a flick the body cannot keep up with leaves it waiting for the trunk rather than torn from the hands. While the hands work on the mount itself, as in a magazine swap on a running body, release it (`orient(mount, null)`) so it rides the chest, and ease back to the aim from the turn it rode at. The body only keeps grips within the arms' length, not off the trunk or within the joints: a turn you ask that brings a grip against the body (a rifle swung across it) leaves a hand that goes back to it held off it, so bring the mount back toward the aim as the hand returns.

Since a body's pose changes only once a tick, however often `update` is called, a first-person camera on it must blend the body's nodes and the eye between its last two ticks for display, and turn the shown body about the eye to the mouse's current yaw and pitch every rendered frame; the view and the held weapon then follow the mouse without a tick's lag.

For a hit or recoil, `body.applyImpulse(impulse, point)` rocks a person's torso, which springs back while the hands keep their grips and targets; the root stays with locomotion or the controller.

For a custom creature, combine a skeleton with `species(skeleton, roles, tuning)`; [lion-species.ts](references/lion-species.ts) is a complete four-legged species to start from; a species may have two legs or four, and only four carry a `carriage`. Every leg must be able to lift and place its foot, even on a creature that never walks (`LegRole` says what that takes). A creature without a `carriage` has no idle life of its own, so give it life from the story: `pose` for its trunk and `lookAt` for its head. For mouth contact (a horse's or dog's `jaw`), use `reach` with a point, not `lookAt`, which directs gaze. Check a new gait by counting the frames each foot of `body.feet` spends unplanted (`powerGait` says why).

## Check the story

A verb that fails says why only in development: make bodies with `dev: true` while you work on a story (in an app, in its dev server) and print each new `body.log` entry as it arrives; an entry's `detail` says what limited it and by how much (a hand off its goal: beyond the arm's reach, against the trunk, or held by a joint's range), and `dev: { notes: true }` adds what is only reported. Headless runs need a bounded duration and an explicit completion check, as above. Put scene-specific observations in `watch(body, …)` beside the story, raced against its completion. Check the final pose and actual ownership rather than treating elapsed time as success, and judge whether a body stands on its mark by `body.feet`.
