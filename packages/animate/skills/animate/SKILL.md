---
name: animate
description: Animate three.js characters and creatures with @drawcall/animate — a person (`Humanoid`) or any other body (`Body` with a `Species`: the shipped `horse()`, or your own from data) moved by @pmndrs/timeline behaviours that flow into one another — `idle`, `walkTo`, `grab`/`hold`/`carry`/`place`/`release`/`wear`, `lookAt`/`withGaze`/`aimAt` — scripted or driven by a player. Use when writing or reviewing code that imports @drawcall/animate.
---

# @drawcall/animate

## The model

A body runs one behaviour, a [@pmndrs/timeline](https://github.com/pmndrs/timeline) timeline it steps in fixed 1/60 s sub-steps as it is updated. Nothing is keyframed: every sub-step each running behaviour writes goals for the bones it owns and moves toward them from the pose history at its own pace. So any task can end at any moment, and whatever writes those bones next takes them over from where and how fast they were going. Behaviours run in parallel layers, and on a bone two of them write, the later one wins.

The calling convention, for every verb in the package: it returns a `Behaviour`, a function that makes a fresh timeline. Inside a generator, run one to its end with `yield* walkTo(h, { to })()`. To run several at once, pass them uncalled to `parallel<Frame>('all' | 'race', a, b)` and `yield*` that, without calling it. Wait with conditions (`when`, `until`, `timePassed`), never with Promises or wall-clock time.

Units are metres, seconds and radians; +Y is up, the floor is y = 0, and yaw 0 faces +Z, with +X then the body's left. Any goal may be live, a function of the frame read every sub-step: use that for whatever moves.

## Bodies, species and the world

A `Humanoid` is a body made from a @pmndrs/viverse character model, which it poses after every update (`createSkeletonModel()` makes a bare one). Any other body is a `Body` of a `Species`, which is data: a skeleton and, optionally, its gaze, its hands by name, and its legs with their gait and posture. `horse()` ships with the package; *Your own creature* builds a dog.

```ts
const groom = new Humanoid(await loadCharacterModel(), (h) => () => parallel<Frame>('all', idle(h), story(h)), { position: { x: -1.5, z: 0 }, dev: true });

const species = horse();
const start = new Pose(species.skeleton);
start.setRoot(new Vector3(1.2, start.position(0).y, 3));
const mare: Body = new Body(species, () => parallel<Frame>('all', idle(mare), lookAt(mare, () => groom.pose.position(INDEX.head))), { pose: start, dev: true });

const world = new World().add(groom, mare);
// every frame:
world.update(delta);
```

A body alone can be updated by itself. Bodies that share a scene go into one `World`, updated instead of them: each reads the others' last poses, and a walk up to something stands clear of the other bodies' low parts. Scenery is not an obstacle. No body knows of walls, tables or props, except the items it handles (by their `bounds`), so route walks round scenery yourself.

## idle: the base under every story

A body's behaviour is `parallel('all', idle(body), story)`. For a person, `idle` balances, walks where it is asked, breathes, sways, shifts its weight, swings the free arms and looks about, all seeded (`idle(h, { seed })`). Don't author any of that. To have the body stand a while, just wait (`when(timePassed(2, 'seconds'))`). A task wins on the bones it writes and, when it ends, `idle` takes them back. Tasks never write the root or the legs: walks and reaches ask `idle`'s legs for them. For another body, `idle` stands and walks on its species' legs with its posture on top, heeding the `attention` its species reads (the horse: a `tether` while tied, a `startle` point).

## Walking

`walkTo` ends once the body has arrived, turned and settled. Given `until`, it ends when that is met instead, and until then it follows a live `to` however it moves, which is how one body follows another (give the goal's `velocity` too). `within` stops short with the point that far ahead, and `face` sets the facing to arrive with. Leave `speed` off unless matching another body's pace, because walks already slow for what the hands hold. A creature asked to a still goal behind it goes round on an arc; one behind it that moves, it waits for.

The motion conditions — `arriving(h, s)`, `h.locomotion.settled` and `moving` — describe the body now, so they are true at the start for a body standing still. `arriving` also holds when no walk is running and the body is settled. Wait on them only alongside the walk they are to observe, as in the next section.

## Anticipation: start the next thing before this one ends

People look at, turn to and reach for the next thing while still finishing the last. Tasks done strictly one after another read as mechanical. To get this, run the next thing's opening in `parallel('all', …)` with the end of the current one, started by a condition:

```ts
// the eyes on the horse a second before the walk arrives
yield* parallel<Frame>('all', walkTo(h, { to: stall }), function* () {
  yield* when(arriving(h, 1));
  yield* withGaze(h, () => mare.pose.position(HEAD), () => when(timePassed(1.5, 'seconds')))();
});
// the hands letting go while the next grab sets off
yield* parallel<Frame>('all', release(h, ['left', 'right']), grab(h, { right: [rope, 'knot'] }));
```

The opening must leave the bones that are finishing alone, because a later writer wins: start with the eyes and feet while the hands finish, not the hands. The verbs already overlap their own parts: `grab` walks up, looks and reaches at once, so don't walk up and look first yourself.

## Hands and items

An `Item` is a rigid thing with named grips (targets in its frame), a `mass` and a `name`. Give it its mass rather than slowing anything yourself: walks, holds and lifts slow down and prepare for the load. Give a solid item `bounds` from its mesh, so hands approach outside it before closing. Hanging straps are grips, not part of the rigid shell.

There is one verb per intent:
- `grab` takes hold: it walks up, looks and reaches (`walk: false` takes from where the body stands).
- `hold` keeps hold. Without `to`, the hands stay with the item wherever it is, so an item resting on something stays there; to walk off with it, hold it `to` a carry pose such as `carried(h)`.
- `carry` moves an item along waypoints or to a placement and ends there. It takes several items at once as `[[a, wayA], [b, wayB]]`.
- `place` lifts, walks up and puts down.
- `release` lets go.
- `wear` and `takeOff` attach an item to any body's bone and detach it.

What nothing holds or wears stays where it was let go. `handTo` moves a free hand.

```ts
const across = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
const saddle = new Item(new Vector3(-1.1, 0.88, 2), across, {
  left: { position: new Vector3(0.22, 0, 0) }, right: { position: new Vector3(-0.22, 0, 0) },
}, { name: 'saddle', mass: 8 });
const onBack = { position: new Vector3(0, 0.23, 0), quaternion: across }; // in the horse's trunk frame

const story = (h: Humanoid): Behaviour => function* () {
  yield* named('fetch the saddle', grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }))();
  yield* named('saddle the horse', function* () {
    yield* place(h, saddle, onBone(mare, 0, onBack))();
    yield* wear(mare, saddle, 0)(); // the horse moves it from now on
  })();
  yield* withGaze(h, () => mare.pose.position(HEAD), release(h, ['left', 'right']))();
  // something held up to look at it
  yield* grab(h, { right: [rope, 'knot'] })();
  yield* carry(h, rope, facingAt(h, INDEX.head, { position: new Vector3(0, -0.15, 0.35) }))();
  yield* carry(h, rope, [[0.6, carried(h, 'right')], [1.5, still]])();
};
```

A goal lives in one of three frames: the world (the default), a bone (`onBone(body, bone, local)`, or `facingAt` turned with the body's facing rather than the bone), or an item (`onItem(item, local)`). Put what belongs to a body in its frame. `carried(h)` is a carry pose for this body's stature, and `onBone(mare, …)` stays right as the horse moves; the horse's position plus an offset is right only while it stands. In a course, `[seconds, still]` pauses on purpose, and course seconds are written for an unloaded item.

Leave placement to the library: a hand-placed number usually reads worse and breaks for another body. `grab` and `approach` stand where the grips are in comfortable reach, facing squarely; give `face` only for a particular orientation. `release` follows through and settles where the free arms take over. What you author is the scene, the order of beats, the places on props that a course passes, and how long a pause lasts.

## Gaze

`lookAt(body, point)` keeps the eyes on a point, endlessly: the head turns most of the way and the eyes take the rest. `withGaze(h, point, task)` holds them there while a task runs, and with `first: true` the task waits until the eyes are there. Looking low makes the person bow. `aimAt` adds the trunk, for a player's aim. `headTo` puts the head where a headset is, and with `lead` the body follows it. A species without a neck chain, like the horse, turns its head in its posture toward what `lookAt` sets.

## Player control

For a body the player drives, run `idle(h, { root })` with a `DrivenRoot` that your controller moves every frame. The body stands exactly on it and faces its `yaw`, and the legs step to keep up. Ask for a leap with `h.stepper?.jump(speed)`, and read `h.stepper?.airborne` to know when it is in the air.

A held tool that must stay steady in view, such as a first-person weapon, belongs to the aim rather than a hand. Move it yourself every frame before updating the body: place it in the camera's frame, follow only its place in that frame (`follow` / `followRotation`, so carry, aim and sprint poses sway into each other), and `hold` it in both hands with no `to`. Hands holding an item that something else moves keep to its grips at any turn rate. A hand chasing the camera with `handTo` lags and overshoots instead. Keep the tool within the arms' reach.

## Life

A person's quiet life is part of `idle`. A species gives its own as rhythms in its `carriage`: each fires every few seconds (seeded) and eases a value to a new aim, and the carriage turns `head` into a glance about, `weight` into a roll of the spine and `tail` into a swish. A species with a posture of its own reads further rhythms from a `Life`.

## Your own creature

A species is data: a skeleton (bones parents first, bone 0 the root, rest rotations identity, standing square), chains for the neck and for each hand, leg chains with their foot geometry, a gait with how it carries the body (`body`: the trunk's bounce, pitch and roll, the head's nod), and which bones that carriage moves. This dog trots, its whole body riding on the trot, looks about, takes things in its jaw and wags its tail:

```ts
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
// each bone: its name, its parent's, where its joint is standing square, its mass (kg)
const joints: [string, string, Vector3, number][] = [['trunk', '', v(0, 0.46, 0), 15], ['pelvis', 'trunk', v(0, 0.45, -0.16), 4],
  ['neck', 'trunk', v(0, 0.44, 0.27), 2], ['head', 'neck', v(0, 0.62, 0.45), 2.5], ['jaw', 'head', v(0, 0.54, 0.67), 0.3],
  ['tail', 'pelvis', v(0, 0.47, -0.32), 0.3]];
const legs = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];
for (const leg of legs) {
  // (top, knee or elbow, hock or wrist, paw: the elbow bends back, the stifle forward)
  const x = leg.startsWith('left') ? 0.08 : -0.08, fore = leg.endsWith('Fore'), z = fore ? 0.22 : -0.24, knee = fore ? -0.06 : 0.1;
  [v(x, 0.43, z), v(x, 0.28, z + knee), v(x, 0.1, z - knee / 2), v(x, 0.03, z)]
    .forEach((at, k) => joints.push([`${leg}${k}`, k ? `${leg}${k - 1}` : fore ? 'trunk' : 'pelvis', at, 1.5 / (k + 1)]));
}
// each leg joint's range (°): sideways, fore and aft (+ its end back), twist — top, knee or elbow, hock or wrist, paw
const RANGES: Record<string, number[][]> = { Fore: [[25, -70, 70, 20], [5, -100, 30, 5], [5, -10, 110, 5], [15, -60, 90, 10]],
  Hind: [[25, -70, 70, 20], [5, -40, 100, 5], [5, -100, 30, 5], [15, -60, 90, 10]] };
const at = (name: string) => joints.find(([n]) => n === name)![2], deg = Math.PI / 180;
const skeleton = new Skeleton(joints.map(([name, parent, joint, mass]) => ({ name, parent: joints.findIndex(([n]) => n === parent), offset: parent ? joint.clone().sub(at(parent)) : joint, mass, com: v(0, 0, 0) })), {
  chains: { neck: ['neck', 'head'], mouth: ['neck', 'head', 'jaw'] },
  limits: joints.flatMap(([name], bone) => {
    const [, end, k] = /^(?:left|right)(Fore|Hind)(\d)$/.exec(name) ?? [];
    if (!end) return [];
    const [z, back, forth, twist] = RANGES[end][Number(k)];
    return [{ bone, axis: 1 as const, swing: [[-z * deg, z * deg], [back * deg, forth * deg]] as [[number, number], [number, number]], twist: [-twist * deg, twist * deg] as [number, number] }];
  }),
});

const dog: Species = {
  skeleton,
  gaze: { neck: 'neck', eyes: (pose, out) => pose.point(skeleton.index('head'), v(0, -0.02, 0.1), out), range: { down: 0.5, up: 0.4, side: 0.6 } },
  hands: { jaw: 'mouth' },
  legs: {
    chains: legs.map((leg) => ({ joints: [0, 1, 2, 3].map((k) => ({ bone: skeleton.index(`${leg}${k}`), axes: ['yzx', 'x', 'x', 'zx'][k] })),
      heel: v(0, -0.03, -0.02), toe: v(0, -0.03, 0.04), toeOut: 0, rocker: [[0, 0], [1, 0]] })),
    gait: {
      ...powerGait({ height: 0.44, slowest: 0.3, offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: 0.33, clearance: [0.03, 0.03, 0.03, 0.03] }),
      body: { withers: -0.012, croup: [-0.012, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 2, headRise: 0, headWithers: 1 },
    },
    carriage: { pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.6, period: 0.35, cycles: 6 },
      life: [['tail', { every: [2, 5], rate: 1, pick: swing }]] },
  },
};

const rex: Body = new Body(dog, () => parallel<Frame>('all', idle(rex), function* () {
  yield* grab(rex, { jaw: [ball, 'middle'] })(); // trots up, dips its head, takes it
  yield* parallel<Frame>('race', hold(rex, ball), walkTo(rex, { to: v(0, 0, 0.5) })); // and brings it back
}), { dev: true });
```

A hand of a creature is the tip of its chain: `grab` walks the body up until the grip is in the chain's reach, and the chain reaches it. Limits on the bones (`Skeleton`'s `limits`) keep joints in range; a leg needs them, for how far each leg reaches — and so how far it strides and strays as it turns — is read from its joints' ranges. The gait's offsets place each leg's footfall in the cycle in the order of the chains (fore-left, fore-right, hind-left, hind-right); diagonal pairs together make a trot. Each leg needs some bend standing, a reserve for the trunk's bounce.

## Checking

Develop with `{ dev: true }` on every body. Each sub-step then checks the final pose (joint ranges and speeds, planted feet) and appends any problem to `body.log` with its time and beat; `named('beat', task)` labels beats. A body throws only for misuse, such as an item worn twice or a grip that does not exist, and the error carries the time and beat. Lateness never throws, so live input can never crash a game: a reach or carry still short of its goal after its `limit` adds one entry to the log and keeps going. A scripted story therefore fails by stalling rather than throwing. Keep dev on in its tests and assert that `body.log` is empty and the story finished.

A late entry means the goal is out of reach from where the body stands. Change where it stands (approach its destination placement) or change the course; a longer `limit` only reports it later. Name every `Item`, so entries say which one.

Expectations of a scene are watchers, composed beside the story. They read final poses and cost nothing with dev off:

```ts
const watched = (h: Humanoid): Behaviour => () => parallel<Frame>('all',
  eyesOnBefore(h, saddle, 0.4), // the eyes are on it 0.4 s before a hand takes it
  watch('horse clear of the face', (f) => {
    const d = mare.pose.position(HEAD).distanceTo(f.prev.position(INDEX.head));
    return d < 0.5 ? { check: 'head clearance (m)', value: d, limit: 0.5, where: 'head' } : null;
  }),
  idle(h), story(h),
);
```

## Any rig

A skeleton with named chains is enough for a body: build its behaviours from `chainTo` / `ChainTip` / `solveChain` and `follow` / `followRotation` / `TrackedPoint` / `TrackedRotation`. Each of these moves from the pose history toward a goal, which is what lets layers hand over; setting a bone outright (`setLocal` to a fixed rotation) snaps it.

```ts
const arm = new Skeleton(bones, { chains: { arm: ['shoulder', 'elbow', 'hand'] } });
const reacher = new Body({ skeleton: arm }, chainTo('arm', { position: goal }, { accel: 6, speed: 1, until: 'reached' }));
```
