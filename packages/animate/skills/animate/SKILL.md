---
name: animate
description: Animate three.js characters with @drawcall/animate — a humanoid (`Humanoid`, `idle`, `walkTo`, `grab`, `hold`, `carry`, `place`, `release`, `wear`, `withGaze`) or any other body (`Body`, `Species`, `Legs`, a shipped `horse()`) moved by @pmndrs/timeline behaviours that flow into one another, scripted or driven by a player (`idle(h, { root })`, `aimAt`). Use when writing or reviewing code that imports @drawcall/animate.
---

# @drawcall/animate

## The model

A body runs one behaviour, a [@pmndrs/timeline](https://github.com/pmndrs/timeline) generator that `body.update(delta)` steps in fixed 1/60 s sub-steps. Behaviours don't keyframe: every sub-step each one writes absolute goals for the bones it owns and moves on toward them from the pose history, at its own pace. So any task can end at any moment, and whoever writes those bones next takes them over from where and how fast they were going. Wait with conditions (`when`, `until`, `timePassed`), never with Promises or wall time.

A humanoid's behaviour is `parallel('all', idle(h), story)`. `idle` already balances, walks, breathes, sways, shifts weight, swings the free arms and looks about: don't author any of that, and to have the body stand a while, just wait (`when(timePassed(2, 'seconds'))`). A task wins on the bones it writes; when it ends, `idle` takes them back. Tasks never write the root or the legs: they ask `balance` inside `idle`. A hand holding an item keeps it until `release`.

## A story, end to end

A groom fetches a saddle, puts it on a horse, and leads the horse out (`mare` and `HEAD` come from *Other bodies*):

```ts
const across = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
const saddle = new Item(new Vector3(-1.1, 0.88, 2), across, {
  left: { position: new Vector3(0.22, 0, 0) }, right: { position: new Vector3(-0.22, 0, 0) },
}, { name: 'saddle', mass: 8 });
const rope = new Item(new Vector3(0.25, 1.12, 3.6), new Quaternion(), { knot: { position: new Vector3() } }, { name: 'rope' });
const onBack = { position: new Vector3(0, 0.23, 0), quaternion: across }; // in the horse's trunk frame
const gate = new Vector3(0.6, 0, 12);

const groom = new Humanoid(await loadCharacterModel(), (h) => function* () {
  yield* parallel<Frame>('all', idle(h), function* () {
    // walks up; eyes, hands and bow set off before it stands there
    yield* named('fetch the saddle', grab(h, { left: [saddle, 'left'], right: [saddle, 'right'] }))();
    yield* named('saddle the horse', function* () {
      yield* place(h, saddle, onBone(mare, 0, onBack))();
      yield* wear(mare, saddle, 0)(); // the horse moves it from now on
    })();
    yield* named('check the fit', withGaze(h, () => mare.pose.position(HEAD), release(h, ['left', 'right'])))();
    yield* named('lead out', function* () {
      yield* grab(h, { right: [rope, 'knot'] })();
      const near = facingAt(h, h.pose.skeleton.index('chest'), { position: new Vector3(-0.28, 0.04, 0.55) });
      const slack = facingAt(h, 0, { position: new Vector3(0.3, 0.1, 0.25) });
      yield* parallel<Frame>('race', hold(h, rope, { to: near }), handTo(h, 'left', slack, { lead: false }), function* () {
        yield* walkTo(h, { to: gate })();
        yield* when(timePassed(1.5, 'seconds')); // keep both hands in the lead pose through the halt
      });
    })();
  });
}, { position: { x: -1.5, z: 0 } });
const world = new World().add(groom, mare); // each reads the others' last poses
function update(dt: number) {
  world.update(dt);
}
```

## Anticipation: start the next thing before this one ends

People look at, turn to and reach for the next thing while still finishing the last; tasks done strictly one after another read as mechanical. The one mechanism: run the next thing's opening in `parallel('all', …)` with the current thing's end, started by a condition (`when(arriving(h, s))` for a walk, or your own over the task's state). It works at every granularity:

```ts
// beat to beat: eyes on the horse a second before the walk arrives; hands letting go while the next grab sets off
yield* parallel<Frame>('all', walkTo(h, { to: stall }), function* () {
  yield* when(arriving(h, 1));
  yield* withGaze(h, () => mare.pose.position(HEAD), () => when(timePassed(1.5, 'seconds')))();
});
yield* parallel<Frame>('all', release(h, ['left', 'right']), grab(h, { right: [rope, 'knot'] }));

// within a task: grab and withGaze overlap their own parts; don't walk up and look first yourself
yield* grab(h, { right: [rope, 'knot'] })();

// one course through several places passes them without stopping
const clear = { position: new Vector3(-1.1, 1.2, 2) };
const over = { position: new Vector3(0, 1.7, 2) };
const down = { position: new Vector3(0, 1.6, 3) };
yield* carry(h, saddle, [[0.5, clear], [0.8, over], [0.5, down]])();
```

One verb per intent: `grab` gets (it walks up and looks unless `walk: false`), `hold` keeps, `carry` moves along waypoints or to a placement and ends when it is there (several items at once: `carry(h, [[a, wayA], [b, wayB]])`), `place` puts down, `release` lets go, `wear`/`takeOff` attach. `[seconds, still]` holds a course still on purpose; `[seconds, carried(h)]` lifts into a carry pose that follows the body throughout the course. `arriving` also succeeds when no walk runs and the body is settled, so an approach already in reach can finish an `until: arriving(…)` hold. The next thing's opening must leave the current thing's bones alone (a later writer wins): eyes and feet while the hands finish, not the hands.

## Units, frames and goals

Metres, seconds, radians; +Y up, the floor at y = 0; yaw 0 faces +Z and +X is then the body's left. Goals live in one of three frames: the world (the default), a bone (`onBone(body, bone, local)` or `facingAt(h, bone, local)`), or an item (`onItem(item, local)`). For a carry on another body, use `{ frame: onBone(body, bone) }`; for an item, `{ frame: onItem(item) }`. Any goal may be live, a function of the frame read every sub-step: use that for whatever moves.

Place what belongs to a body in its frame: `carried(h)` rather than a carry height like `y: 1.08` (right for one stature only), `onBone(mare, …)` rather than the horse's position plus an offset (right only while it stands still). Time beats by task conditions or distances to props, not raw coordinates such as `root.z > 8.2`.

## Leave placement to the library

The defaults place and time things from the body, the load and the task; a hand-placed number usually reads worse and breaks for another body. Leave `spot` off `grab` and `approach` (they stand where the grips are in comfortable reach; placing points face squarely unless you give `face` for a particular orientation; a blocked explicit `face` throws), options off `release` (it follows through and settles where the free arms take over), and `speed` off walks unless matching another body's pace. Give items their `mass` rather than slowing anything yourself: walks, holds and lifts slow and prepare for the load, and course seconds are written for an unloaded item. Give solid items `bounds` from their mesh so hands approach outside the volume before closing. The default encloses only the centre and grips and can be flat or a line; it cannot describe solid volume. Hanging straps are grips, not the rigid shell. For hollow headwear, carry it above the head and let `wear` settle it onto the skull. Use `place(h, item, destination)` for a lift, approach and placement; keep a moving destination live with `onBone`. Carry poses come from `carried(h)` / `carried(h, 'right')`. To step back while keeping the facing, snapshot the target before walking: `const back = h.pose.position(0).clone().add(new Vector3(0, 0, -0.3).applyAxisAngle(new Vector3(0, 1, 0), h.locomotion.facing));` then `yield* walkTo(h, { to: back, face: h.locomotion.facing })();`.

What you author: the scene, the order of beats, the places on props a course passes, and how long a pause lasts.

## Other bodies

A `Body` is any species with a behaviour. A horse ships with the package (`horse()`): like a humanoid it stands and walks with `idle` and goes where `walkTo` asks, its pelvis, legs and head working together. A `Humanoid` is a `Body` too. For your own creature, `Legs` steps legs under a root the behaviour moves. Any body can `wear` items, and `onBone` and `carry`'s `frame` place things on it as it moves. Add every body, the horse too, to one `World` (`world.add(...)`) and update the world each frame: approaches then choose stands clear of the other bodies' low segments.

Run `lookAt(mare, point)` beside its `idle` for what it attends (it looks round at a person within 5 m, ears first, and keeps its head away when they come close). Its `idle` heeds its `attention`: a live `tether` (`position`, `length`) while tied, and a `startle` point — a new point each time, such as the groom's position at saddle placement or girth tightening, which it turns to and settles from in about four seconds. Return `undefined` when absent or untied. To follow someone, run `walkTo` with a live `to` (and its `velocity`) and `until: () => false`. Use `horseLeadPoint(mare.pose, out)` for an attention-following hand station that ignores gait pitch and nod; draw the rope from the actual halter. Standing ears, tail and head move within 25 seconds; hind-leg rest starts after at least 60 seconds of quiet.

```ts
const species = horse();
const HEAD = species.skeleton.index('head');
const start = new Pose(species.skeleton);
start.setRoot(new Vector3(1.2, start.position(0).y, 3));
let startle: Vector3 | undefined; // set a new point to startle it
// Tied up until the rope is taken; then a rope's length behind the groom.
const behind = (f: Frame) => {
  if (rope.supported) return start.position(0);
  const at = groom.pose.position(0), back = f.prev.position(0).clone().sub(at).setY(0);
  return back.length() < 2.4 ? f.prev.position(0).clone() : back.setLength(2.4).add(at);
};
const mare: Body = new Body(species, () => parallel<Frame>('all',
  lookAt(mare, () => groom.pose.position(INDEX.head)),
  idle(mare, { attention: { startle: () => startle } }),
  walkTo(mare, { to: behind, speed: 1.6, accel: 0.65, until: () => false }),
), { pose: start });
```

## Checking

Develop with `{ dev: true }` on every body: each sub-step checks the final pose (joint ranges and speeds, planted feet) and appends problems to `body.log`, each with its time and beat. `named('beat', task)` labels beats; wrap a one-shot timeline as `named('beat', () => parallel<Frame>('all', a, b))`. A body throws only for misuse (an item worn twice, a grip that does not exist), and the error carries the time and beat. Something running late never throws, so live input can never crash a game: a reach or carry still short of its goal after its `limit` adds one entry to the log and keeps going.

```text
{ time: 4.917, beat: 'take foregrip', check: 'late reach: grip distance after 4 s (m)', value: 0.081, limit: 0.01, where: 'rifle left foregrip' }
```

So a scripted story fails by stalling, not by throwing: keep dev on in its tests and assert `body.log` is empty and the story finished. A late entry means the goal is out of reach from where the body stands: change where it stands (approach its destination placement) or the course. A longer `limit` only reports it later. Name every `Item` so entries say which.

Expectations of the scene are watchers, composed before the story; they read final poses and cost nothing with dev off:

```ts
yield* parallel<Frame>('all',
  eyesOnBefore(h, saddle, 0.4), // the eyes are on it 0.4 s before a hand takes it
  watch('horse clear of the face', (f) => {
    const d = mare.pose.position(HEAD).distanceTo(f.prev.position(INDEX.head));
    return d < 0.5 ? { check: 'head clearance (m)', value: d, limit: 0.5, where: 'head' } : null;
  }),
  idle(h), story,
);
```

## Player control

For a body the player drives, call `idle(h, { root })` with a `DrivenRoot` that your controller moves every frame: the body stands exactly on it and faces its `yaw`, and the legs step to keep up. Ask a leap with `h.stepper.jump(speed)` and read `h.stepper.airborne`. `aimAt(h, point)` turns the trunk and gaze toward where the player looks.

A held tool that must stay steady in the player's view, such as a first-person weapon, belongs to the aim, not to a hand. Move it yourself every frame, before updating the body: place it in the camera's frame (eye position plus look rotation), follow only its place in that frame (`follow` / `followRotation`, for carry, aim and sprint poses that sway into each other), and hold it in both hands (`hold(h, item)` with no `to`). Hands holding an item that something else moves keep to its grips at any turn rate, and the body does not lean after it. If a hand chases a camera-relative target with `handTo` instead, the tool lags and overshoots on fast turns. Keep the tool where the arms can reach it, because a hand can only keep up with a grip that is within reach.

## Any rig

```ts
const skeleton = new Skeleton(bones, { limits, chains: { arm: ['shoulder', 'elbow', 'hand'] } });
const body = new Body({ skeleton }, chainTo('arm', { position: goal }, { accel: 6, speed: 1, turnAccel: 40, until: 'reached' }));
```

A body is made from a `Species`: its skeleton and, optionally, its `gaze` (`lookAt`/`withGaze`/`aimAt`), its `hands` by name (each the skeleton chain that reaches with it, the hand its tip: `hands: { jaw: 'mouth' }`), and its `legs` (`chains`, a `gait` — `powerGait({ height, slowest, offsets, stride, stance, clearance })` — and a `posture` written over them each sub-step, where a `Life` of `Rhythm`s gives it a seeded quiet life). Such a body `idle`s and `walkTo`s on its legs, and `grab(body, { jaw: [ball, 'middle'] })` walks it up, reaches the hand's chain to the grip and closes; `hold(body, ball)` brings the chain back to rest with the item on it. Bones are listed parents first, bone 0 the root, rest rotations identity (+Y up, facing +Z). Build your own behaviours from `follow` / `followRotation`, `TrackedPoint` / `TrackedRotation`, `ChainTip` and `solveChain`: each moves from the history toward a goal, which is what lets layers hand over; setting a bone outright (`setLocal` to a fixed rotation) snaps it.
