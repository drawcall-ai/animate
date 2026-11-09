---
name: animate
description: Write or review code that moves bodies with @drawcall/animate (`Body`, `walkTo`, `grab`, `pose`, stories on `runTimeline`), including custom species, crowds and player-driven bodies. Not for rigging a mesh (@drawcall/rig's skill) or playing baked animation clips.
---

# @drawcall/animate

A story is a generator on the app's `runTimeline` from @pmndrs/timeline; advance it before updating each body. The body supplies idle motion and balance, so a pause usually needs only `wait`. Units are metres, seconds and radians; +Y is up, +Z forward, +X the body's left. Each verb's doc comment has its options and exact behaviour; this skill covers which to reach for and how they combine.

Your app and this library must share one copy of three; a second copy breaks every `instanceof`, and the first target or `Body` built from it throws saying so.

A verb does nothing until `yield*`ed. A mover (`walkTo`, `reach`, `grab`, `carry`, `throwAt`) ends when its goal is met. An aimer (`lookAt`, `track`, `pose`) returning `true` says only that it ended: a person's head stops about 1.64 rad either way, turning the shorter way round for what is behind it, and the eyes add a little, so turn the body for more. It never ends by itself, so `yield*` one alone runs for ever: race it or give it `until`, and give a `pose` that should end once it has come a `hold`.

A verb returns `true` when what it moved stands there within its tolerance as it ends (an aimer when it ends), and `false` only when your own `until` cut a mover short: nothing has gone wrong. When it cannot get there it throws `Missed`, `until` or not, whose message says where it stopped and what to change. That reaches your `update` once and ends the story, so where a miss is an ordinary turn of events, take it with `attempt` and go on (`attempt` discards the verb's return, so a `false` reads as `null`; `release` is no verb, and throws its `Missed` at the call, so take that with `try`):

```ts
import { attempt, grab, type Body, type Verb } from '@drawcall/animate';
import type { Object3D } from 'three';

function* takeIfNear(body: Body, cup: Object3D): Verb {
  const miss = yield* attempt(grab(body, cup, { right: 'handle' }, { step: false }));
  return miss === null;
}
```

## A whole story

This headless hand-over uses the shipped [person skeleton](references/person.ts); copy that file to `references/` beside your script. The box has constructed grip empties; no model or renderer is required. Two hands cannot share a spot, so the box has grips for each body, and the giver lets go only once the receiver holds it.

```ts
import { Group, Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, Body, carry, grab, grip, humanoid, play, release, wait } from '@drawcall/animate';
import { PERSON } from './references/person.ts';

const giver = new Body(humanoid(PERSON), { dev: true });
const receiver = new Body(humanoid(PERSON), { dev: true, at: new Vector3(0, 0, 1.6), face: Math.PI });
const scene = new Group();
scene.add(giver.object, receiver.object);
const box = new Object3D();
box.name = 'box';
box.userData.mass = 2;
box.position.set(0, 0.9, 0.45);
// (where each palm closes; facing the giver, the receiver's left is the giver's right)
grip(box, 'left', new Vector3(0.15, 0, 0));
grip(box, 'right', new Vector3(-0.15, 0, 0));
grip(box, 'receiver left', new Vector3(-0.15, 0, 0.08));
grip(box, 'receiver right', new Vector3(0.15, 0, 0.08));
const shelf = new Object3D();
shelf.name = 'shelf';
shelf.position.set(0.8, 1, 1.2);
scene.add(box, shelf);
scene.updateMatrixWorld(true);

play([giver, receiver], function* () {
  yield* grab(giver, box, { left: 'left', right: 'right' });
  yield* parallel('race', carry(giver, box, new Vector3(0, 1.05, 0.8), { until: Infinity }), function* () {
    yield* wait(arriving(giver, 0)); // the offer at rest
    yield* grab(receiver, box, { left: 'receiver left', right: 'receiver right' });
  });
  release(giver, box);
  yield* carry(receiver, box, shelf);
  release(receiver, box, shelf);
}, { limit: 20 });
if (giver.holds(box) || receiver.holds(box) || box.parent !== shelf) throw new Error('Box was not placed');
if (giver.log.length || receiver.log.length) throw new Error(JSON.stringify([...giver.log, ...receiver.log]));
```

In an app the story runs on `runTimeline` instead, its step called each frame before each body's `update`; `play` is that loop headless, for verification.

Write each beat as a `function* (…): Verb` that takes the bodies and things it acts on, and work out marks that depend on where bodies stand when the beat reaches them. `parallel('race', …)` returns what the winning branch returned and `'all'` returns `false` if any branch did; a `Missed` in a branch ends the `parallel`, so `attempt` takes one round it too. To start a beat already holding something, `grab` it with `already: true` as the story starts.

## Choosing a verb

To go somewhere, `walkTo`. To take a thing, `grab`, which walks up, looks and reaches by itself: skip a `walkTo` unless the body must stand on a particular mark. To move what is held, `carry`; to let go, `release`. A `grab` leaves the body where it stood to take the thing, so `walkTo` afterwards if where it ends up matters. To bring a hand to a place without holding (a touch, a point), `reach`, which has a reach's timing and can fail. To keep hands on something moving (a clap, XR controllers), `track`, which never arrives. For where the eyes go, `lookAt`. For the shape of the body (a nod, a bow, a wave, a crouch), `pose`, which adds onto whatever else runs; a tilted look is a `lookAt` raced with a head `pose`.

A gesture is a loop of short poses, each held long enough to arrive, since a pose ended early comes out smaller: `hold` ends one that long after it has come. A pose's arms give way to a hand verb or a held thing.

To sit a person, `yield* sit(body, seat)`: `seat` is the point on the surface under its hips, best an empty on the chair whose +Z is the way the sitter faces. It walks there, round the chair if behind it, sits and ends seated, then stays so, with `lookAt`, `reach`, `grab` and `pose` working as usual, until `yield* stand(body)`, a `walkTo` or a `reach` needing its legs stands it. It throws `Missed` for a seat too high or too low for its legs, or no level floor for its feet. Nothing collides, so its way round goes through a wall behind the seat: bring a walled seat from the front.

No body kneels, lies or climbs. A pose's `lower` is a deep crouch on both feet and reads as one. For those, use a puppet: stop updating the body and write its `bones` from its last pose yourself, placing each hand with `@drawcall/animate/puppet` every frame, with a grip empty wherever a hand holds. To hand back, create a fresh body where it stands and blend from your pose onto it.

## Knowing when something has finished

- A thing is held: `grab` returned `true`, or `body.holds(thing)`.
- A walk has ended: only once its feet are squared, a second or two after it stands there. `arriving(body, seconds)` is true that long before a mover ends, so `arriving(body, 2)` is about when a walk gets there. It counts only movers begun once it is made, so make it before or beside the verb it times; with no mover it stays false forever.
- A body stands on its mark: `body.feet`. `body.position` is its hips, which sway.
- A body is at rest: `body.settled`. This is about the feet only, and is true while a pose is still easing in or out.
- A pose has arrived: give it `hold`. Eased back: nothing reports it, so read the bone you care about.

```ts
import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { pose, wait, type Body, type Verb } from '@drawcall/animate';

function* crouchAndLook(body: Body, look: () => Verb): Verb {
  const hips = () => body.bones.hips.getWorldPosition(new Vector3()).y, standing = hips();
  const result = yield* parallel('race', pose(body, { lower: 0.4 }), function* () {
    yield* wait(() => hips() < standing - 0.35); // down
    return yield* look();
  });
  yield* wait(() => hips() > standing - 0.02); // back up: `body.settled` would pass at once
  return result;
}
```

Check a story with `play`: a story still running at its `limit` throws, naming each verb running and where it was called. To measure as it runs, give `frame: (time) => …`, called after the bodies update each frame. A headless run does not refresh `matrixWorld`, so read a bone with `getWorldPosition` or `getWorldQuaternion`, which do; `localToWorld` needs `updateWorldMatrix(true, false)` first. Make bodies with `dev: true` while you work and read `body.log` after it: one row per motion check, place and running verbs (balance, feet, joint speed), each with its worst value. It holds what a step of motion got wrong, not failures, which throw whether dev is on or not. A row marginally over its `limit` for a few sub-steps (`count`) is rarely visible: watch it and move on. One well over, or for many, usually means the verb in its `beat` asks too much of that part: ask less, or more slowly. An app with dev on only in development has it off in its tests, so pass it there. A verb called but never `yield*`ed, and a fallback the body took, are said once on the console. `body.owners` shows who holds each part, but empties once a race ends, so signal moments from the beat after the verb.

## Overlapping

Natural motion starts the next task's preparation before the current one ends: the eyes, then the turn, then the hands. Plain walk-then-look-then-reach reads as mechanical. So put eyes, poses and hands-up preparation beside a walk, timed on `arriving`. A hand verb that may walk picks where to stand as it starts, so start it once its target has come to rest, and after a walk to a mark end that walk on `until: arriving(body, 0.5)` and start the hand verb then. The two hands are separate parts too: `parallel('all', carry(body, cup, ready), grab(body, lid, { left: 'rim' }))` brings the other hand in while the first is still moving.

Each part does one thing at a time. An asked part beats a borrowed one and a newer asked verb overrides an older one until it ends, so a look beside a grab directs the eyes without interrupting the hands. The trunk is one part: a `lookAt` given `trunk` and a trunk `pose` take it from each other, so a look restarted in a loop takes back a coil you posed.

## Hands on things

Give a movable thing its `userData.mass` (and `userData.centre` if its mass is off its origin) and grips: `grip(thing, name, at, spec)`, or in a model an empty with the same keys in its extras. A key on a grip's empty that no grip reads is said once on the console: it may be a typo. What a thing gripped by its own name holds in its `userData` is its own. Declare on each grip what the hand touches, not where the wrist goes: leave free what any way round will do, and fix what the hand must keep. `facing` points from the hand into the thing, the way the touching palm or pad faces.

- Laid on a surface (a box's side): a plain empty where the palm's middle goes, with a facing if the palm must lie flat.
- Round something (a handle, a rung, a rail): `handle`, the line pointing out of the fist at the thumb's end. Add a facing for anything held one way; `radius` where the meshes do not show how far the palm lies off the line (alone: a ball); `length` to slide along it. To pinch something flat, put the handle along an edge, facing onto it.
- A fingertip (a button): `point` names the digit, with a facing. A facing the wrist cannot turn to leaves the pad off, and the `grab` misses a moment after touching, saying so. Make the button a massless thing of its own, its cap's mesh beside it, and move it in as it is pressed.
- One digit apart from the rest (a trigger, a thumb on a spoon): `digits` names an empty its pad goes to; move the empty to move the digit. Fix the grip's facing so the digit already lies over it.

```ts
import { Vector3, type Object3D } from 'three';
import { grip } from '@drawcall/animate';
declare const mug: Object3D, panel: Object3D;

grip(mug, 'handle', new Vector3(-0.06, 0, 0), { handle: [0, 1, 0], facing: [1, 0, 0], radius: 0.012 }); // for a hand from -X: thumb up, palm toward the mug
grip(panel, 'button', new Vector3(), { point: 'index', facing: [0, 0, 1] }); // on a wall ahead, its face to -Z
```

If a carry misses `held off by a joint's range`, the wrist cannot turn that far from how it holds: change the grip's roll or the target's turn, not its position.

A part of a held thing (a lid, a pin) is a thing of its own with its own mass and grips, parented where it sits: the other hand grabs it, `carry` lifts it off, and `release` onto an empty puts it back. A hand holding something lets go of it when it grabs something else, and a thing both hands leave stays where it is, even in mid-air: put it down first, or if it rides on an empty under the body, aim it with `body.orient` each frame before `update`. Take it back with one `grab` of both grips, since one hand at a time leaves the other idle. Targets for what a person does about itself come from `body.armPoint`.

A `grab` or `reach` that no stand brings there misses at once with the hand unmoved: use that to ask whether it can. For a try the viewer sees (a jar on too high a shelf), walk under it and race a `reach` given `until` with what the rest of the body does: the arm goes as far as it can and the `Missed` comes 2 s on, for `attempt` to take: `const miss = yield* parallel('race', attempt(reach(body, { right: jar }, { until: Infinity })), lookAt(body, jar, { until: Infinity }), pose(body, { lower: -0.08 }))`.

To throw what one hand holds, turn the body toward the target first, `throwAt` it, and give its `released` motion to your physics. It goes either way; a target beyond its speed misses after the follow-through.

A hold does not bring the feet: a thing your story moves (a door on its hinge) leaves a body standing still behind, its hand off the grip and `holds` still `true`, said once on the console. Walk the body with it, keeping its facing: a 0.4 rad/s swing with `walkTo(body, beside, { speed: 0.4, face })` beside it stays on; or `release`.

A carry's or reach's hold ends with the verb: after it the thing rides the hand and drifts a few centimetres as the arm eases, so `release` onto the target as the carry ends. To keep it exactly there, race it with `until: Infinity`.

What is held rides the hands through a walk, swinging with them: a tray sinks and bobs some 10 cm and tips by several degrees. To keep a thing level or steady as the body walks, or to route it, walk beside a raced carry to an empty on `body.object` where it should ride: `parallel('race', carry(body, tray, ride, { until: Infinity, step: false }), walkTo(body, mark))`, with one walk after another for a way round something, since a list of targets given to `carry` routes the thing within the arms' reach and not the feet.

### Bringing something to the face

`carry` puts the thing's origin at the target, turned as the target is, so to bring one point of it (a rim) somewhere, offset the target by that point. A target on the `head` bone moves with the head and needs tilting to be reachable: a cup level at the mouth is held off by the wrist. A thing brought to the face stops clear of it, and a target nearer than that misses, naming the clearance. An 8 × 10 cm cup tilted 0.9 rad comes no nearer than its rim 11 cm before the nose, level 15 cm; a smaller thing comes nearer. A head `pose` closes only millimetres of that. It reads as a sip from a distance; no verb gives contact with the lips.

```ts
import { Object3D, Quaternion, Vector3 } from 'three';
import { carry, type Body, type Verb } from '@drawcall/animate';

function* sip(body: Body, cup: Object3D, rim: Object3D): Verb {
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.9), head = body.species.person!.head;
  const lips = new Object3D();
  lips.quaternion.copy(tilt);
  lips.position.set(0, head.nose.y - 0.03, head.nose.z + 0.12).sub(rim.position.clone().applyQuaternion(tilt));
  body.bones.head.add(lips);
  return yield* carry(body, cup, lips);
}
```

A carry to an empty on the body leaves the hand keeping to that empty, moving with it, until the next hand verb: so leave the empty there at least until then.

## Walking and running

`speed` is an upper limit, reached with room to speed up: a person asked 3 m/s needs ~5 m, speeding up and braking. The gait follows it, with no other word: a person breaks into a run from 2 m/s, is running by 3, and goes 4 m/s at most (× √ its legs' length); a creature goes as fast as its legs keep up. On a straight, asking faster does not arrive later, within its last step or so. A walk that turns first or arrives turned goes as its turn lets it, so asking faster may not help, and may land a second or so later. A walk that ends on arriving, held well short of a speed above a stroll it had the room for, says so in `body.log` under `dev`: `walk speed not reached`.

Bodies of different sizes walk at different paces, and `speed` holds them together only once each is up to it: a person reaches 90% of 1.3 m/s in 1.5 s and of 3.5 m/s in 2.2 s, a dog in 2.8 s and 4.3 s, so a dog started beside a person falls behind. To hold a formation, walk followers to targets in their own lanes, ending when the leader arrives; give the slower starter that lead, since a lane target behind a follower turns it round. To lead a horse, take the rope first: a tether limits its head's reach but does not make it follow.

To walk beside a body (a dog at heel, a guard, a child, a crowd after its leader), follow an empty parented to its `object`, racing the leader's story: `heel.position.set(-0.6, 0, 0); person.object.add(heel); yield* parallel('race', function* () { yield* walkTo(person, yard, { speed: 3 }); yield* wait(2); }, walkTo(rex, heel, { speed: 4, until: Infinity }))`. Its `speed` is an honest limit: give it about a third above the leader's or it never closes (`walk cannot keep up` in `body.log` says so). Keep a mark still otherwise: without `until` a walk to an empty on a body stalls and misses as that body breathes. A mark is an empty on the floor, its +Z the way to face. Grips and approach empties belong to the thing, so the story survives moved furniture; build hand targets from `body.species.person`'s measures, not metres.

A stage or stairs is the `floor` function, the same for every body on the set; walks do not handle ramps or shallow treads, so use level areas and treads sized for the largest foot. Bodies keep their feet clear of each other but plan no path round things, and hands and carried things pass through anything: route a body with one `walkTo` after another, ending each with its own `until` on how near the body has come so it flows on (`arriving` waits for its stop).

## Skeletons and species

A bare body and a skinned body use the same skeleton. Only skinning a mesh needs `@drawcall/rig`; a bare body and the skeleton files here do not. To skin one, install it, follow its skill, and pass the rigged scene as `model` and the skin report as `mass`. A humanoid's bones take the `HumanoidBone` names whatever a rig guide suggests. Skeletons face +Z in metres at real size, since sizes set strides and reach. The [person](references/person.ts), [horse](references/horse.ts), [dog](references/dog.ts) and [lion](references/lion.ts) are starting points; another height is the person's positions scaled. Bodies that start together read as copies: give each its own `life.seed`, and do not start identical walks on one frame. A person at attention takes `life: { steady: 1 }`.

For hair, tails and other swinging chains, spread the species and add `springs: { braid: { stiffness: 18, damping: 0.55, hang: [-2.2, 0, 0] as const } }`, keyed by an existing root bone; one setting covers the hierarchy below it. Skin hair standing clear of the body and give its root the `hang` turn it falls from. A person's springs keep out of its own head and trunk; nothing else collides.

For a custom creature, start from [lion-species.ts](references/lion-species.ts); `@drawcall/animate/species` has what its definition needs. Every leg must be able to lift and place its foot. A creature without a `trunk` has no idle life, so give it life from the story. A creature's hand is its mouth (`jaw`), named in `grab` and `reach`; a person's hand keys are `left` and `right`. Check a new gait by counting the frames each foot of `body.feet` spends unplanted.

## Players and crowds

Use `drive` when an app owns the root, a player's input or its own physics, the legs following it through running and jumping, and `track` for a headset and controllers; scripted hands and eyes still act on that body. When a physics controller owns movement, give the body the same world-space `floor` as its colliders and keep `body.object` at the world's frame rather than parenting it to a moving platform: use the root's `platform`, moved before the body updates, and a floor's `platform(x, z)` method where a foot lands on another moving surface. Do not animate takeoff or landing yourself. For a hit, `body.applyImpulse`. A first-person camera must blend the body's nodes and the eye between its last two ticks, since a pose changes once a tick.

A body costs about 0.1 ms a frame (some 120 fit 60 fps in a browser), and updating a distant one less often saves nothing. For hundreds, simulate those the camera sees closely and let copies replay a nearby body's bones, varying which body and how many frames behind, and keep real bodies where eyes must meet something.
