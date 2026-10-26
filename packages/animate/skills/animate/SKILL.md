---
name: animate
description: Animate three.js characters and creatures with @drawcall/animate — people, horses, dogs or creatures of your own from a rigged skeleton — by stories of verbs (walkTo, grab, carry, release, reach, lookAt, track) run on an @pmndrs/timeline runner over a body that stands, walks and looks about by itself, scripted or driven by a player. Use when writing or reviewing code that imports @drawcall/animate.
---

# @drawcall/animate

## The model

A story is any `function*` your app runs with `runTimeline` from @pmndrs/timeline. Verbs are generators: `yield* walkTo(body, target)` runs one to its end and returns `true` once its goal is met, `false` once it cannot be (no stand reaches the grips, the walk stalled). `parallel('all' | 'race', …)` runs verbs and generators at once; `wait(seconds | () => boolean)` waits; every verb takes `until` (seconds, a condition or `Infinity`), which ends it `true` whatever its goal. `release` alone is instant: call it without `yield*`.

```ts
const updateStory = runTimeline(function* () {
  yield* grab(person, box, { left: 'left', right: 'right' }); // walks up, eyes first, hands rise before it arrives
  yield* carry(person, box, shelfTop);                        // in over the front edge, by the shelf's own approach
  release(person, box, shelfTop);                             // attached to the shelf, exactly there
});
function everyFrame(seconds: number) {
  updateStory(undefined, seconds);
  person.update(seconds);
  mare.update(seconds);                                       // bodies read each other as they were before this frame: any order
}
```

The story decides once per frame; the motion runs in fixed 1/60 s sub-steps inside `update` and never waits on the story. Units are metres, seconds and radians; +Y is up, the floor is y = 0, a facing of 0 looks along +Z, with +X then the body's left. A target is a `Vector3` (a point), an `Object3D` (it moves with its parent and also sets the orientation: an empty, a bone, `body.bones.head`) or a function of the body's time returning either.

## Bodies

A body is a species of a skeleton — `humanoid(skeleton)`, `horse(skeleton)`, `dog(skeleton)` or `species(skeleton, roles, tuning)` — where the skeleton is @drawcall/rig's `SkeletonBone[]` written for the mesh (`as const`, so bone names are checked). Rig the mesh with `await skin(container, skeleton)`, then `new Body(humanoid(skeleton), { model: container })`: the body drives the rig's bound bones by name. Add `body.object` (a group on the floor that follows the body, holding the model) to the scene once, under an untransformed parent. Without `model` the body is bare, for tests and headless runs; `body.bones` are then its own.

Options: `at` and `face` where it starts; `mass` (kg, or rig's skin report when the mesh is closed); `life` fixes its variation (`seed`) and says what tethers or startles a creature; `tempo` paces it; `drive` hands its root to a player (below); `avoid` lists bystanders its walks keep clear of (the bodies it deals with it keeps clear of anyway); `dev` turns on checking. State: `position`, `velocity`, `facing`, `settled`, `airborne`, `gait`, `feet`, `holds(thing)`, `goals`, `pose`, `log`.

## What a body does by itself, and what a story asks

A person balances, breathes, sways, shifts its weight, swings its free arms and looks about by itself, seeded; a creature stands, glances and swishes its tail. Never author any of that: to stand a while, `wait`.

Each part of a body — its legs, eyes, trunk and each hand — does one thing at a time. A verb asks for the parts it is about (`walkTo` the legs, `lookAt` the eyes, `grab` the hands) and borrows the rest it needs (`grab` borrows the legs to walk up and the eyes to find the grips). The newest asked verb takes a part; when it ends, the one it overrode takes the part back from where it is, so nothing snaps. Anything asked beats anything borrowed, and among borrowers the first keeps the legs. So run things side by side freely: a `lookAt` over a `grab` takes only the eyes. `body.goals` says which verb holds each part (verb, call site, tier) when a scene does something unexpected.

## Anticipation: the next thing starts before this one ends

People look at, turn to and reach for the next thing while still finishing the last; tasks strictly one after another read as mechanical. Start the next thing in `parallel('all', …)` with the end of the current one, on `arriving(body, seconds)` (true once what the body moves toward will arrive within that time, or once it rests):

```ts
yield* parallel('all', walkTo(groom, stall), function* () {
  yield* wait(arriving(groom, 1));
  yield* lookAt(groom, mare.bones.head, { until: 1.5 });   // the eyes on the horse a second before the walk arrives
});
```

The verbs overlap their own parts already: `grab` walks, looks and reaches at once, so do not walk up and look first yourself. Hand things over on conditions, never on time.

## Things

A thing is any `Object3D`. `userData.mass` (kg) makes it movable, and the body slows and prepares for it: give the mass instead of slowing anything yourself. Grips are named empties under the thing (`{ right: 'handle' }`; the thing's own name is its origin). An empty that things are put onto or taken from may name its `userData.approach` (empties beside it, outermost first: a shelf's front edge, a scabbard's way out) and `userData.speed` (m/s on the last straight); `carry` comes in, and goes out, that way.

A thing moves with its scene-graph parent, and the verbs re-parent it:
- `grab` never takes a thing off what it is attached to. A loose thing with mass (on no body) is lifted clear and drawn in; anything else stays where it is and the hands follow it (a sword in its scabbard, a door handle).
- `carry` moves what is held to a target or through a list of targets — off its hip or pouch first, out the way its empty's approach comes in, walking there if it must, in by the target's approach — and keeps it there.
- `release(body, thing, onto?)` attaches it onto the empty `onto` (exactly there within 5 mm), else to another hand still holding it (that body moves it now: a hand-over), else back to the parent it was taken from, where it is. The hands back out the way they came in.
- What a body wears is whatever its bones carry in the scene graph: add a thing under `body.bones.hips` and the body bears its weight.

Leave standing to the library: `grab`, `reach` and `carry` stand where the grips are in comfortable reach, facing them squarely, or take them from where the body stands when they are in reach. What you author is the scene: its places and empties, the order of beats, and the pauses.

## Gaze and tracking

`lookAt(body, target, { trunk, until })` keeps the eyes on a target (with `trunk`, the trunk turns with them, as an aim does). It is an aimer: it never ends by itself, so give it `until` in a sequence or run it in a `parallel`. `track(person, { head, left, right })` follows a headset and controllers.

## Player control

`drive: (time) => ({ position, yaw, velocity?, crouch?, steady?, jump? })` gives a person's root to your controller, read every sub-step at its time: the body stands on that point facing that way and its legs step to keep up. Nothing borrows a driven body's legs (`walkTo` throws for it), but its hands, eyes and trunk take any verb. `crouch` goes straight to 0 or 1 from the key, the legs ease it; `steady` (0 at ease, 1 aiming) fades its breathing and sway; `jump` is a leap's speed up.

## Creatures of your own

`species(skeleton, roles, tuning)`: `roles` says what the bones do — the `root`, the `legs` (each a joint chain top to paw with its heel and toe, fore-left, fore-right, hind-left, hind-right), the `gaze` (a neck chain and the eyes on a bone), the `hands` (a chain each to the hand or jaw) and the `carriage` its gait moves; `tuning` gives its `gait`, each bone's mass and centre, joint ranges (`limits`: a leg needs them, for how far it reaches is read from them) and `inertia`. `@drawcall/animate/species` holds what a species needs: `powerGait`, `footfalls` and `carriages` (gaits that change with the pace), `scaled` (another size, dynamically similar), `Life` and `swing` for its quiet life. `src/dog/dog.ts` is a complete example. A creature's hand is the tip of its chain: `grab` walks it up until the grip is in reach and the chain takes it, one hand at a time.

## Checking

Develop with `{ dev: true }` on every body. Every sub-step then checks the final pose (joint ranges and speeds, planted feet, balance, the hands on what they hold) and the scene (a thing let go in mid-air, put onto an empty far off it or taken, re-parented under a hand by something else; a lifted thing without mass; an aimer without `until` in a sequence; a story that stopped stepping its verbs) and appends each problem to `body.log` with its time and the verbs running. Lateness never throws: a reach or carry still short of its goal adds one entry and keeps going, and a goal nothing can reach ends its verb `false`. A body throws only for misuse (a grip that does not exist, carrying what no hand holds), the error carrying the time and verbs. So test stories with dev on, and assert the outcomes, that the story finished and that `body.log` is empty. What a body only reports, never as a failure (a player's body off balance where the player takes it), goes to `body.notes` with `dev: { notes: true }`.

A scene's own expectations are watchers beside the story: `watch(label, () => problem | null)` checks every frame and puts what it finds into the log of the body the problem names.

```ts
yield* parallel('race', story(), watch('horse clear of the face', () => {
  const distance = mare.bones.head.getWorldPosition(new Vector3()).distanceTo(groom.bones.head.getWorldPosition(new Vector3()));
  return distance < 0.5 ? { body: groom, check: 'head clearance (m)', value: distance, limit: 0.5, where: 'head' } : null;
}));
```
