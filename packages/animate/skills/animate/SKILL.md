---
name: animate
description: Animate three.js characters with @drawcall/animate — a humanoid (`Humanoid`, `idle`, `walkTo`, `grab`, `hold`, `carry`, `place`, `release`, `wear`, `withGaze`) or any other body (`Body`, `Legs`, a shipped horse) moved by @pmndrs/timeline behaviours that flow into one another. Use when writing or reviewing code that imports @drawcall/animate.
---

# @drawcall/animate

## The model

A body runs one behaviour, a [@pmndrs/timeline](https://github.com/pmndrs/timeline) generator that `body.update(delta)` steps in fixed 1/60 s sub-steps. Behaviours don't keyframe: every sub-step each one writes absolute goals for the bones it owns and moves on toward them from the pose history, at its own pace. So any task can end at any moment, and whoever writes those bones next takes them over from where and how fast they were going. Wait with conditions (`when`, `until`, `timePassed`), never with Promises or wall time.

A humanoid's behaviour is `parallel('all', idle(h), story)`. `idle` already balances, walks, breathes, sways, shifts weight, swings the free arms and looks about: don't author any of that, and to have the body stand a while, just wait (`when(timePassed(2, 'seconds'))`). A task wins on the bones it writes; when it ends, `idle` takes them back. Tasks never write the root or the legs: they ask `balance` inside `idle`. A hand holding an item keeps it until `release`.

## A story, end to end

A groom fetches a saddle, puts it on a horse, and leads the horse out (`horse` and `HEAD` come from *Other bodies*):

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
      yield* place(h, saddle, onBone(horse, 0, onBack))();
      yield* wear(horse, saddle, 0)(); // the horse moves it from now on
    })();
    yield* named('check the fit', withGaze(h, () => horse.pose.position(HEAD), release(h, ['left', 'right'])))();
    yield* named('lead out', function* () {
      yield* grab(h, { right: [rope, 'knot'] })();
      yield* parallel<Frame>('race', hold(h, rope, { to: carried(h, 'right') }), walkTo(h, { to: gate }));
    })();
  });
}, { position: { x: -1.5, z: 0 } });
```

## Anticipation: start the next thing before this one ends

People look at, turn to and reach for the next thing while still finishing the last; tasks done strictly one after another read as mechanical. The one mechanism: run the next thing's opening in `parallel('all', …)` with the current thing's end, started by a condition (`when(arriving(h, s))` for a walk, or your own over the task's state). It works at every granularity:

```ts
// beat to beat: eyes on the horse a second before the walk arrives; hands letting go while the next grab sets off
yield* parallel<Frame>('all', walkTo(h, { to: stall }), function* () {
  yield* when(arriving(h, 1));
  yield* withGaze(h, () => horse.pose.position(HEAD), () => when(timePassed(1.5, 'seconds')))();
});
yield* parallel<Frame>('all', release(h, ['left', 'right']), grab(h, { right: [rope, 'knot'] }));

// within a task: grab and withGaze overlap their own parts; don't walk up and look first yourself
yield* grab(h, { right: [rope, 'knot'] })();

// one course through several places passes them without stopping
yield* carry(h, item, [[0.5, clear], [0.8, across], [0.5, down]])();
```

`[seconds, still]` holds a course still on purpose; `[seconds, carried(h)]` lifts into a carry pose that follows the body throughout the course. `arriving` also succeeds when no walk runs and the body is settled, so an approach already in reach can finish an `until: arriving(…)` hold. The next thing's opening must leave the current thing's bones alone (a later writer wins): eyes and feet while the hands finish, not the hands.

## Units, frames and goals

Metres, seconds, radians; +Y up, the floor at y = 0; yaw 0 faces +Z and +X is then the body's left. Goals live in one of three frames: the world (the default), a bone (`onBone(body, bone, local)` or `facingAt(h, bone, local)`), or an item (`onItem(item, local)`). For a carry on another body, use `{ on: onBone(body, bone) }`; for an item, `{ on: onItem(item) }`. Any goal may be live, a function of the frame read every sub-step: use that for whatever moves.

Place what belongs to a body in its frame: `carried(h)` rather than a carry height like `y: 1.08` (right for one stature only), `onBone(horse, …)` rather than the horse's position plus an offset (right only while it stands still). Time beats by task conditions or distances to props, not raw coordinates such as `root.z > 8.2`.

## Leave placement to the library

The defaults place and time things from the body, the load and the task; a hand-placed number usually reads worse and breaks for another body. Leave `stand` off `grab` and `approach` (they stand where the grips are in comfortable reach; placing points face squarely unless you give `face` for a particular orientation), options off `release` (it follows through and settles where the free arms take over), and `speed` off walks unless matching another body's pace. Give items their `mass` rather than slowing anything yourself: walks, holds and lifts slow and prepare for the load, and course seconds are written for an unloaded item. Use `place(h, item, destination)` for a lift, approach and placement; keep a moving destination live with `onBone`. Carry poses come from `carried(h)` / `carried(h, 'right')`. To step back while keeping the facing, snapshot the target before walking: `const back = h.pose.position(0).clone().add(new Vector3(0, 0, -0.3).applyAxisAngle(new Vector3(0, 1, 0), h.gait.facing));` then `yield* walkTo(h, { to: back, face: h.gait.facing })();`.

What you author: the scene, the order of beats, the places on props a course passes, and how long a pause lasts.

## Other bodies

A `Body` is any skeleton with a behaviour. A horse ships with the package: `horseFollow` moves it toward a floor goal with its pelvis, legs and head working together. For your own creature, `Legs` steps legs under a root the behaviour moves. Any body can `wear` items, and `onBone` and `carry`'s `on` place things on it as it moves. Update every body each frame.

```ts
const HEAD = HORSE_SKELETON.index('head');
const start = new Pose(HORSE_SKELETON);
start.setRoot(new Vector3(1.2, start.position(0).y, 3));
// Tied up until the rope is taken; then follow a rope's length behind the groom.
const horse: Body = new Body(HORSE_SKELETON, horseFollow(start, (f) => {
  if (rope.supported) return { position: start.position(0) };
  const at = groom.pose.position(0);
  const back = f.prev.position(0).clone().sub(at).setY(0);
  return { position: back.length() < 2.4 ? f.prev.position(0) : back.setLength(2.4).add(at) };
}), { pose: start });
```

## Checking

Develop with `{ dev: true }` on every body: each sub-step checks the final pose (joint ranges and speeds, planted feet) and appends problems to `body.log`, each with its time and beat. `named('beat', task)` labels beats; wrap a one-shot timeline as `named('beat', () => parallel<Frame>('all', a, b))`. Thrown errors carry the label too:

```text
13.350 s, "saddle the horse": "saddle" left grip "left": 0.035 m off; right grip "right": 0.035 m off; 0.035 m off course end after 2 s
```

A throw like this means the goal is out of reach from where the body stands: change where it stands (approach its destination placement) or the course; a longer `limit` only throws later. Name every `Item` so errors say which.

Expectations of the scene are watchers, composed before the story; they read final poses and cost nothing with dev off:

```ts
yield* parallel<Frame>('all',
  eyesOnBefore(h, saddle, 0.4), // the eyes are on it 0.4 s before a hand takes it
  watch('horse clear of the face', (f) => {
    const d = horse.pose.position(HEAD).distanceTo(f.prev.position(INDEX.head));
    return d < 0.5 ? { check: 'head clearance (m)', value: d, limit: 0.5, where: 'head' } : null;
  }),
  idle(h), story,
);
```

## Any rig

```ts
const skeleton = new Skeleton(bones, { limits, chains: { arm: ['shoulder', 'elbow', 'hand'] } });
const body = new Body(skeleton, chainTo('arm', { position: goal }, { accel: 6, speed: 1, turnAccel: 40, until: 'reached' }));
```

Bones are listed parents first, bone 0 the root, rest rotations identity (+Y up, facing +Z). Build your own behaviours from `follow` / `followRotation`, `TrackedPoint` / `TrackedRotation`, `ChainTip` and `solveChain`: each moves from the history toward a goal, which is what lets layers hand over; setting a bone outright (`setLocal` to a fixed rotation) snaps it.
