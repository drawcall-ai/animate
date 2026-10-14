---
name: animate
description: Animate three.js characters with @drawcall/animate — a body (a humanoid from a @pmndrs/viverse model, or any articulated rig) moved by behaviours written as @pmndrs/timeline timelines that write its pose layer by layer; a humanoid base (`idle`: balance, free arms, gaze) with tasks over it (`walkTo`, `handTo`, `headTo`, `grab`, `carry`, `hold`, `wear`, `release`, `withGaze`, `ask`) chained so each flows into the next (`overlap`, a walk's `Eta`), and the generic pieces under them (`follow`, `Glide`, `TrackedPoint` / `TrackedRotation`, `ChainTip` / `chainTo`, `lookAt`, carriers). Use when writing code that imports @drawcall/animate.
---

# @drawcall/animate

A body runs **one behaviour timeline**, stepped in fixed sub-steps of 1/60 s (`STEP`): `update(delta)` runs as many as the time covers and carries the rest over. Behaviours are [@pmndrs/timeline](https://github.com/pmndrs/timeline) generators; compose them with `parallel`, `action`, `timePassed` and its other helpers. No Promises inside behaviours: wait with conditions and `timePassed` (simulation time).

## Frames and layers

Each sub-step every running action's `update(frame)` gets a `Frame`: its `dt` and `time`, the body's `world`, the two last final poses `prev2` and `prev` (read only), and `current`, the pose being written (it starts as a copy of `prev`). The poses rotate every sub-step: read them from the frame each time, never keep them.

Children of a `parallel` are stepped in the order given and a later writer wins on the bones it writes. Order them root to tip: whoever writes an ancestor (the pelvis, the trunk) runs before whoever places its descendants in the world (a hand on a target), or the later write moves the hand off it. A bone nobody writes keeps last sub-step's rotation.

Nothing smooths, limits or fades for you, and nothing should: every behaviour writes **absolute goals** for the bones it owns, moved on from the history at its own pace (`follow` / `followRotation`, or a `TrackedPoint` / `TrackedRotation` for a goal that moves on its own; a `ChainTip` brakes the joints of a solved chain itself). That is what makes layers hand over continuously: when a layer above ends, the bones are where it left them, moving as it moved them, and the layer below — which follows its own goal from that history — takes them on from there. A layer that sets bones outright (`setLocal(bone, rotation)`) snaps them instead.

## The humanoid

```ts
import { parallel } from '@pmndrs/timeline';
import { loadCharacterModel } from '@pmndrs/viverse';
import { Humanoid, idle, walkTo, type Frame } from '@drawcall/animate';

const model = await loadCharacterModel();
scene.add(model.scene);
const body = new Humanoid(model, (h) =>
  function* () {
    yield* parallel<Frame>('all', idle(h), function* () {
      yield* walkTo(h, { to: new Vector3(1, 0, 3), face: 0 })();
      // … the next task
    });
  },
);
body.update(delta); // every frame
```

`new Humanoid(model, behaviour, { world, position, yaw })` starts standing relaxed in its stance; without a model file, `createSkeletonModel(height)` gives a bare-bones one. Read back `body.pose`, `body.feet`, `body.gait`, `body.holding`, `body.worn`, `body.borne`, `body.proportions`.

**The root is always `parallel('all', idle(h), tasks)`.** `idle(h)` is the endless base, root to tip: `balance` (the only writer of the root, the legs and the trunk's posture: it stands, keeps the extrapolated centre of mass over the feet with a step when it would fall, walks (turning where it stands first for a goal far off its facing, no faster round a bend than the feet hold it, stopping over two or three shortening steps and only then turning to a facing asked), lowers and bows, squares the feet when it stops; walking only, running is not judged yet), `hangArms` (arms hanging, swinging with the steps) and `lookAround` (eyes on the way ahead, a glance now and then standing still). Tasks run after it and win on what they write; when they end, the base takes their bones back on.

**Tasks never write the root, legs or trunk (but `headTo`, which places the spine under the eyes): they ask `balance` through `h.asks`** (`go`, `face`, `lower`, `bow`, …). Each field is last-writer-wins and must be rewritten every sub-step the task wants it; `balance` reads and clears the asks at the start of its update, so it acts on them a sub-step late. `lean`, `onto` and taken feet are not taken yet (`balance` throws on them).

Tasks:
- `walkTo` walks to a point (a live one is followed), turns to `face`, or both; it ends once the body has settled on squared feet. Give it `until` to keep following a point that moves on (it then ends only when `until` is met). `within` stops short of the point, squarely before it. Give it an `eta` to read how soon it arrives (see Anticipation below).
- `handTo` moves a wrist (and, given a rotation, the hand) to a target at a calm everyday pace by default (`CALM`), the clavicle shrugging and the elbow swivelling as the target asks; a target below the arm's reach asks `balance` to bow and squat, one above to go up on the toes (`lead: false`: the hand only follows, as a tracked controller does under a tracked head). Endless, or `until: 'reached'`. A target that moves fast wants brisker joints too (`turnAccel`), or the arm swings behind it. For a discrete reach give it `seconds`: the hand glides there along a minimum-jerk path (a bell of speed, no snap as it sets off) — `reachFor` times its reaches so, by how far they go; a hand left to `CALM` alone gets there as fast as it may, which reads as mechanical.
- `headTo` puts the eyes (and turns the head) where a tracker says, through the spine; with `lead` the body comes along under the head — turning round once it is turned past what the trunk and neck take, bowing and squatting for it, stepping where the eyes go. It writes the spine and the chest: put it after `idle` and before the hand tasks, which hang off the chest it places.
- `release` lets go: the hands open and go off what they held, carried on the way they were going and out from the item (or each its own way, `away`, in the body's frame), as near as the arm reaches as the body stands (it never bows after them) — then the free arms take them. It ends by itself after a moment, so a next task may take a hand on its way off.
- `ask` asks `balance` for what no task asks (a facing while the hands work, how low to stand), every sub-step it runs; a live value is read every sub-step.
- `grab` takes hold of items, each hand its own (`{ left: [item, grip], right: [item, grip] }`): it walks up to stand before them (`approach`; no step when they are in reach already; facing so the left hand's grip is on the left, or as `face` says; `stand` where), and before it has arrived the eyes go to them (`withGaze`) and the hands set off toward them; once it stands they take hold (`reachFor`: one shared condition, no hand closes before all are there). Both hands going, the right leads and the left follows a moment later, a little slower — never a mirror image. Then hold on with `hold`, which keeps the hands on the grips; with `to`, the hands carry it there (no further out than they reach) and the item is fitted to the wrists every sub-step: `hold` is its one mover, so it never leaves the hands. `openHand` / `closeHand` only mark what a hand holds (`h.holding`): there are no fingers.
- `carry` takes items along courses through a frame (a bone's, the world): each course one smooth curve through its legs' placements, passing them without stopping and timed over its whole length, coming to rest only at its end, where a leg holds still (`still`), or where the way turns back on itself. Write a course as the few places the item passes, not as moves that each stop. `course` alone gives the same curve as a live goal for `hold`.
- `wear` puts an item on a bone, or on another worn item (a sword in its scabbard): from then on the body moves it with what it is worn on, after its behaviour every sub-step (`to`: it settles there; a second mover throws). `takeOff` gives it back to whatever moves it next — the hands that hold it. An `Item`'s `mass` counts in the body's centre of mass while it holds or wears it (`h.borne`: taken up and given up over a moment); `balance` steps for it when it would fall, but does not yet stand the loaded centre of mass over the feet, so a heavy load held out in front leaves it a little ahead. An item starts `supported` (resting on a table, a rack, a peg): a hand that only grasps it bears none of its weight until `hold` with `to` or `carry` takes it off its support, or the body wears it; let go of where nothing else holds or wears it (`release`), it rests where it was put and is supported again.
- What a body is dressed in from the start (harness it stands in) goes to the `Humanoid`'s `wearing` option rather than to `wear`: each piece placed on its bone for the body's proportions and borne from the first sub-step, with no settling and no weight taken up over a moment.
- Goals that move with the body or an item: `onBone(h, bone, local, { facing })` (a placement on a bone, or at its joint turned as the body faces), `onItem(item, local)`.
- A reach or a carry that cannot get there throws: an unreachable goal fails visibly rather than waiting forever.
- `lookAt(h.gazer, point)` turns the head to a point, most of the way (the eyes take the rest of a turn aside), as fast as the look is large: a small one slowly, a large one briskly; put it after the base's `lookAround` (it overrides the neck and head) and it touches nothing below them.
- `pelvisTo` (the root) and `trunkTo` (the chest) are for a task that owns the whole body; `pelvisTo` asks for both feet, which `balance` does not take yet, so neither runs under `idle` today.

## Composing tasks

- Eyes before hands: `withGaze(h, at, task)` looks at `at` and sets `task` off once the eyes are there and a moment more, and keeps them there till it ends (`grab` does). With `first: false` the eyes join work already under way.
- End tasks with `until` conditions, not with an update returning false (that spends the frame). An action whose condition is met hands the frame on to what follows, so no sub-step goes unwritten; in a `race`, put the timeline whose condition ends it first, and what follows takes over in that same sub-step (put last, it takes over a sub-step later).
- **Hands that work together share one `until`.** `parallel('all', handTo(a, { until: 'reached' }), handTo(b, { until: 'reached' }))` lets the first hand there go (and the base swing it away) while the other is still reaching; give both the same condition, `(f) => reached(…a…) && reached(…b…)`, as `reachFor` and `carry` do.
- A goal can be a value or a function of the frame (`Live`); a function is read every sub-step. Feed a moving goal's velocity in where a `Target` takes one, or it is followed with a lag.

## Anticipation: one thing flows into the next

People never finish one thing, stand still, and start the next: coming up to something they already look at it, turn to it and reach for it; letting go of one thing their eyes are on the next. Doing tasks strictly one after another is what makes motion read as mechanical. Chain them so the next one's opening runs while the current one ends:

- `overlap(first, next, at)` runs `first` and sets `next` off while `first` still runs, once `at` holds (or `first` has ended); it ends when both have. Nothing fades: `next` is layered after `first`, and each follows its own goals from history, so it simply begins following them. `next` wins where both write, so give it an opening that leaves `first`'s bones alone until `first` is done with them (eyes and feet first; hands once the last hands are free).
- What to wait for: a walk's `Eta` (`walkTo({ eta })`, `before(eta, seconds)`) — the eyes about 0.6–1 s before arriving, the hands about half a second; a beat's work done, while its hands `release` (the next starts with its eyes and feet, its hands taking over a hand on its way off); a carried thing coming upright, a course nearly over.
- `grab` already overlaps its approach with its gaze and reach; between standing tasks, overlap each one's `release` with the next.
- Never start a stage on elapsed time where an arrival condition exists: `timePassed` makes every beat open with the same still prelude.

## Any rig

```ts
import { Body, chainTo, Skeleton, type Frame } from '@drawcall/animate';

const skeleton = new Skeleton(bones, { limits, chains: { arm: ['a', 'b', 'tip'] } });
const body = new Body(skeleton, chainTo<unknown>('arm', { position: goal }, { accel: 6, speed: 1, turnAccel: 40, until: 'reached' }));
body.update(delta); // read body.pose
```

Bones are listed parents first, bone 0 the root; rest rotations are identity (+Y up, facing +Z). Chains list a joint and its descendants down to the tip, each the child of the one before.

- `chainTo` moves a chain's tip on to a target every sub-step and solves the chain to it (a two-segment chain bends toward a `pole`), braking its joints with `turnAccel`; a behaviour that moves a chain its own way keeps a `ChainTip` and calls `tip.to(frame, target, options)`. The tip is never pulled quite straight (a straight limb swivels on any wobble), and moves on from where it put it while the tip is within a few cm of that (the joints' lag behind the solve is not read as its motion).
- `solveChain` alone solves a chain to a goal at once, within the joints' limits. A pole turns the limb at once: move a pole like any goal, never switch it.
- `follow` / `followRotation` give the next value of something moving toward a goal from its history, within an acceleration and speed; with `on` the goal is in a `Carrier`'s frame and the value rides along with it.
- `TrackedPoint` / `TrackedRotation` follow a goal that moves on its own, its velocity fed forward from the goals they were given (a smoothly moving goal is followed without lag, a jump faster than `speed` is braked). Keep one per goal and behaviour.
- `lookAt` turns a `Gazer`'s neck chain so its eyes are on a point, upright (for a point below and behind, pitched down past straight down rather than turned round, whichever leaves the eyes less to turn; it keeps to that way as the body sways).
- A `Carrier` is a rigid frame with the same history as a body (a cart, a held `Item`): its one mover moves it once per sub-step, **before** anything that reads it moves (a second move in a sub-step throws). Several bodies share a `World`; set `world.bodies` to each one's last pose (copies) before updating them, so the order they update in changes nothing.
