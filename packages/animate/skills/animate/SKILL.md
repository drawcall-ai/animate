---
name: animate
description: Author or review procedural character motion and stories with @drawcall/animate, using skeletons rigged by @drawcall/rig; includes bare bodies, crowds, custom species and player-driven motion.
---

# @drawcall/animate

A story runs on the app's `runTimeline` from @pmndrs/timeline; step it before updating each body. The body supplies idle motion and balance, so a pause usually needs only `wait`, unless you deliberately override that motion. Units are metres, seconds and radians; +Y is up, +Z is forward and +X is the body's left.

## Compose around contact

Check a grab or carry's outcome before starting a dependent action. A time-based `until` ending is not proof of contact. For a hand-over, give the object grips for each body: the giver's hands are still on theirs while the receiver takes hold, and two hands cannot share one spot (the dev log says so). Facing each other, the receiver's left hand takes the side that is the giver's right. Keep the giver carrying while the receiver grabs, confirm the receiver holds the object, then release the giver: the object changes holder without teleporting. Start the receiver's grab once the offer has come to rest (`arriving(giver, 0)`): a grab begun while the thing is still moving goes for where it was, and fails or jars the giver's arms.

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
// (the giver's grips at the box's sides, the receiver's beside them on its own end: facing the giver, its left is the giver's right)
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

Use `parallel('all', …)` when every branch must finish, and `'race'` to cancel the rest when one finishes. Race endless aimers such as `lookAt` or a sustained carry against the sequence that ends them. To anticipate the next task, start its preparation beside the current task with `parallel` and `arriving`; strict walk-then-look-then-reach sequences read as mechanical. A walk ends only once its feet are squared and settled, about a second after the body is there, so what follows it in plain sequence starts from a dead stop; start it beside the walk on `wait(arriving(body, seconds))` instead, which counts that settling. Grab already overlaps its own walking, looking and reaching; low reaches and grabs recruit crouching automatically as needed. A reach, grab or carry beyond arm's length (about 0.95 × `armLength` from the shoulder) first walks the body up and leaves it standing there, which moves its mark; pass `step: false` to keep the feet planted, and the verb ends false when the arms and trunk cannot get there. Such a verb judges its reach from where the feet stand as it starts, so start it after the walk that places them, not on `arriving`. With `dev: { notes: true }`, `body.notes` records each such walk.

Each body part does one thing at a time. An asked verb beats a borrowed part; a newer asked verb overrides an older one until it ends. Thus a look beside a grab directs the eyes without interrupting the hands. Inspect `body.owners` when that composition surprises you.

Choose the verb by what the motion is judged on. `reach` takes the hands to a target with a human reach's timing and is judged on getting there: it fails, saying why, when it cannot. `track` keeps each hand on a target that moves, at once and without arriving, and never ends on its own; use it for a clap, a wave or a fist pump as well as for controllers, with targets within about 0.95 × `species.person.armLength` of the shoulder at `shoulderHeight`, since an arm does not stretch further. An empty parented to `body.object` is a target in the body's own frame (+Z its facing) that turns with it, and its rotation turns the hand. For a gesture such as a nod, a bow, an arched back or a head tilt, use `pose`: it adds trunk and head angles on top of whatever the body is doing and eases them in and out, so a short pose is a nod and poses in sequence blend into each other. Keep `lookAt` for where the eyes go (its `roll` and `pitch` tilt the head while it looks). Moving a look or track target to fake a gesture also borrows the trunk or legs, and the gesture reads smaller than its numbers. A pose's head offset sits on top of the gaze instead of taking the eyes, so pair it with a look to keep the eyes on someone. A trunk pose competes for the trunk with a `lookAt` that uses `trunk`. No body kneels, sits or lies down, and a stopped dog stands; a pose's `lower` crouches a person in balance, which is the nearest to a kneel.

## Stories that compose

Write each beat as a function that takes the bodies and props it acts on and returns a `Verb` (an endless one is still typed `Verb`, so it fits `parallel`), and make the bodies, props and marks once, outside every beat. A beat that builds its own cast, or works out its marks from where the bodies stand when it is set up, cannot follow another beat that has moved them; work out such marks inside the story, when the beat reaches them. When other parts of the scene key off a moment (a camera cut when the medal is hung), let the beat say so itself, with a callback or flag after the verb that does it, rather than reading it back off `body.owners`.

## Bodies and places

A bare body and a skinned body use the same skeleton. For a mesh, resolve the installed `@drawcall/rig` package and read its `skills/rig/SKILL.md` to measure the model and author the skeleton; a humanoid's bones take the VRM names the types list (`hips`, `leftUpperArm`, …), not the Mixamo names that skill suggests. The skeleton is written in model space with the body facing +Z, in metres at its real size, since sizes set strides and reach: bake a model's facing, scale and floor into its mesh before rigging, and reduce its triangles first (generated models often arrive about 1 m tall, facing +X, with over a million triangles). The reference [person](references/person.ts), [horse](references/horse.ts), [dog](references/dog.ts) and [lion](references/lion.ts) skeletons are starting points; mesh positions must fit the mesh, and a person of another height is the person skeleton's positions scaled. Put each joint on its limb's centre line where the mesh bends, even when a check complains: limbs are measured straightened, so a joint moved to gain reach or quiet a check, such as an upper-arm joint pulled in toward the spine, makes a limb of another length that moves wrongly.

A person steps as its legs' length has it: longer legs take slower, longer strides at the same pace, so people of different sizes walking together fall out of step on their own. Give a character a gait of its own with `humanoid(skeleton, { stride })`, multipliers on the defaults: a swagger `{ cadence: 0.85, width: 1.3, toeOut: 1.3 }`, a lumber `{ cadence: 0.85, width: 1.25, bob: 1.4 }`. Balance can still quicken a step it must catch, so check the walk rather than trusting the cadence number. A body's `tempo` sets the pace of walks without a `speed`, plus reaches and carries; it does not change how a walk with a given `speed` steps.

For a self-contained GLB with cached weights in rig 0.5, use `await new RigLoader().loadAsync({ url, skeleton, source: { url, dependencyUrls: [] } })` and add `vitecache()` from `vitecache/vite` to the host’s Vite plugins. Pass the returned `scene` as the body’s `model`. For existing or procedural objects, `await skin(model, skeleton)` binds directly without caching. The skin report (`rig.report` for the loader) retains `closed` and `volume`; pass the report as the body’s `mass` to derive kilograms from enclosed volume.

Targets are scene points, objects or functions returning them. Use a point when only position matters; a scene empty also supplies orientation, which a hand or jaw then turns to match, and follows its parent. To look someone in the eyes, give `lookAt` the other body itself; it follows their eyes as they move, with no helper needed. Hands and walks take a place on a body, such as one of its bones, not the body. Turn a placement empty's +Z toward the direction the body should face there. A walk faces the way it goes and turns to its facing only over its last step or two, so a step back or aside longer than about 0.35 m turns the body away and round again; keep such steps short. To turn on the spot, walk to where the body stands with a `face`, and give it a fixed facing or point: facing something that moves re-aims the steps mid-swing. Grips and approach empties belong to the prop, so the same story can work with moved furniture. The body avoids other bodies, but does not plan paths around props.

A raised stage, a dais or stairs is the body's `floor: (x, z) => number`, the floor's height under a world point; give every body on it the same function. Place marks on the floor (a mark's height off it is said in the dev log); what a body reaches for, looks at or carries to is the world point it is, so a target on a dais needs no shift. Ramps, and stairs with ordinary 0.28 m treads, are not handled: stage the action on level areas and deep treads.

To move bodies together — a line abreast, an escort, a horse led — give each the same explicit `speed`: left to their defaults, bodies of different sizes walk and climb at different paces and string out. To keep a formation on a leader, walk each follower to a target in its own lane (an empty parented to the leader's `object`, or a function of time moving at the shared pace), ending when the leader arrives. A walk to a moving target catches up at its `speed` and then matches the target's velocity, so give that speed a little headroom over the shared pace, start each body near its lane, and never move a lane target behind where its follower starts, which turns the follower round. To lead a horse, take the rope first; a tether limits its head's reach but does not make it follow, and the scene owns the visible rope.

Give movable props their mass and named grips. Taking hold of a worn object leaves it attached until carrying starts; this lets a hand find a sword before drawing it. Approaches describe the path out of or into a placement. Creature carry rejects multiple waypoints, nonempty approach routes and placement speed metadata; use a single target and verb pace options.

## Many bodies

A body costs roughly a tenth of a millisecond of CPU a frame, more with dev on, and `update` always runs whole 1/60 s sub-steps, so updating a distant body less often saves nothing. For hundreds, simulate the bodies the camera sees closely and let copies of the model replay a nearby body's pose: its `object`'s transform and each of its `bones`' local position and quaternion are the whole pose, under the model's bone names. A copy repeats its source's gaze and hands in the source's frame, so it does not look at something near it; vary which body and how many frames behind each copy follows, and keep real bodies wherever eyes must meet something.

## Players and custom species

Use a body's `drive` for a player-controlled root with procedural legs, and `track` for its headset and controllers; scripted hands and eyes can still act on that body.

For a custom creature, combine a skeleton with `species(skeleton, roles, tuning)`; [lion-species.ts](references/lion-species.ts) is a complete four-legged species to start from, and the types describe each input. What they leave to you:

- Every leg must be able to step, even on a creature that never walks: a top joint that turns every way (`'yzx'`; without its twist the sole cannot stay flat), a rest chain bent enough to keep spare reach with the sole flat after the gait lowers it, and a gait (`powerGait` with a small `slowest` suffices for one that only stands). A rigid strut needs a hinge partway down for that spare reach.
- A `carriage` needs exactly four legs; it carries the trunk over the gait and gives the creature its quiet life (glances, weight shifts, a tail's swish). Without one, a creature stands still but for its `inertia` lean, so give it life from the story: `pose` for its trunk (small angles, as its legs allow) and `lookAt` for its head.
- A rigid head (a dome, a turret) is a one-bone neck chain: the bone the eyes ride on.
- A hand is a chain tip: the horse and dog expose `jaw`, and creature hands act one at a time. Use `reach` with a point for mouth contact, not `lookAt`, which directs gaze; an empty as the target also asks the jaw to match its rotation.
- A `powerGait` that does not suit the legs can leave a foot only a frame or two to swing, which reads as a teleport and which the dev log does not always report. Check a new gait by counting the frames each foot of `body.feet` spends unplanted, turning on the spot and walking, and adjust `stance` until every swing lasts a visible while; for a small biped with footfalls `[0, 0.5]`, stride 2.3 with stance 0.7 stepped cleanly where 0.5 and 0.93 did not.
- Use `swing` for a tail's life and the gait helpers (`footfalls`, `carriages`) to change footfall timing and carriage with pace.

## Check the story

Use dev-enabled bodies and inspect their logs and notes alongside verb outcomes; an entry's `detail` says what limited it and by how much. An unreachable reach ends false; headless runs still need a bounded duration and an explicit completion check, as above. Put scene-specific observations in `watch(body, …)` beside the story, raced against its completion. Check the final pose and actual object ownership rather than treating elapsed time as success; a standing body sways a few centimetres about its mark.
