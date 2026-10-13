---
name: animate
description: Animate three.js characters with @drawcall/animate — a body (a humanoid from a @pmndrs/viverse model, or any articulated rig) moved by behaviours written as @pmndrs/timeline timelines that write its pose layer by layer; a humanoid base (`idle`: balance, free arms, gaze) with tasks over it (`walkTo`, `handTo`, `headTo`, `grab`, `hold`, `release`, `ask`; `pelvisTo` / `trunkTo` for a task owning the whole body), and the generic pieces under them (`follow`, `TrackedPoint` / `TrackedRotation`, `ChainTip` / `chainTo`, `lookAt`, carriers). Use when writing code that imports @drawcall/animate.
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

`new Humanoid(model, behaviour, { world, position, yaw })` starts standing relaxed in its stance; without a model file, `createSkeletonModel(height)` gives a bare-bones one. Read back `body.pose`, `body.feet`, `body.gait`, `body.holding`, `body.proportions`.

**The root is always `parallel('all', idle(h), tasks)`.** `idle(h)` is the endless base, root to tip: `balance` (the only writer of the root, the legs and the trunk's posture: it stands, keeps the extrapolated centre of mass over the feet with a step when it would fall, walks (turning where it stands first for a goal far off its facing, no faster round a bend than the feet hold it, stopping over two or three shortening steps and only then turning to a facing asked), lowers and bows, squares the feet when it stops; walking only, running is not judged yet), `hangArms` (arms hanging, swinging with the steps) and `lookAround` (eyes on the way ahead, a glance now and then standing still). Tasks run after it and win on what they write; when they end, the base takes their bones back on.

**Tasks never write the root, legs or trunk (but `headTo`, which places the spine under the eyes): they ask `balance` through `h.asks`** (`go`, `face`, `lower`, `bow`, …). Each field is last-writer-wins and must be rewritten every sub-step the task wants it; `balance` reads and clears the asks at the start of its update, so it acts on them a sub-step late. `lean`, `onto` and taken feet are not taken yet (`balance` throws on them).

Tasks:
- `walkTo` walks to a point (a live one is followed), turns to `face`, or both; it ends once the body has settled on squared feet. Give it `until` to keep following a point that moves on (it then ends only when `until` is met). `within` stops short of the point, squarely before it.
- `handTo` moves a wrist (and, given a rotation, the hand) to a target at a calm everyday pace by default (`CALM`), the clavicle shrugging and the elbow swivelling as the target asks; a target below the arm's reach asks `balance` to bow and squat, one above to go up on the toes (`lead: false`: the hand only follows, as a tracked controller does under a tracked head). Endless, or `until: 'reached'`. A target that moves fast wants brisker joints too (`turnAccel`), or the arm swings behind it.
- `headTo` puts the eyes (and turns the head) where a tracker says, through the spine; with `lead` the body comes along under the head — turning round once it is turned past what the trunk and neck take, bowing and squatting for it, stepping where the eyes go. It writes the spine and the chest: put it after `idle` and before the hand tasks, which hang off the chest it places.
- `release` lets go: the hands open and draw back off what they held, then the free arms take them.
- `ask` asks `balance` for what no task asks (a facing while the hands work, how low to stand), every sub-step it runs; a live value is read every sub-step.
- `grab` walks to an `Item`, reaches both hands to its grips together (one shared condition: no hand goes before all are there) and closes them; then hold on with `hold`, which keeps the hands on the grips. With `to`, the hands carry it there (no further out than they reach) and the item is fitted to the wrists every sub-step: `hold` is its one mover, so it never leaves the hands. `openHand` / `closeHand` only mark what a hand holds (`h.holding`): there are no fingers.
- `lookAt(h.gazer, point)` turns the head to a point; put it after the base's `lookAround` (it overrides the neck and head) and it touches nothing below them.
- `pelvisTo` takes the root from `balance`, and both feet with it: a task that runs it owns everything — it places the feet, turns the trunk with `trunkTo`, and puts `lookAt` last.

## Composing tasks

- End tasks with `until` conditions, not with an update returning false (that spends the frame). An action whose condition is met hands the frame on to what follows, so no sub-step goes unwritten; in a `race`, put the timeline whose condition ends it first, and what follows takes over in that same sub-step (put last, it takes over a sub-step later).
- **Hands that work together share one `until`.** `parallel('all', handTo(a, { until: 'reached' }), handTo(b, { until: 'reached' }))` lets the first hand there go (and the base swing it away) while the other is still reaching; give both the same condition, `(f) => reached(…a…) && reached(…b…)`, as `grab` does.
- A goal can be a value or a function of the frame (`Live`); a function is read every sub-step. Feed a moving goal's velocity in where a `Target` takes one, or it is followed with a lag.

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
- `lookAt` turns a `Gazer`'s neck chain so its eyes are on a point, upright (for a point below and behind, pitched down past straight down rather than turned round).
- A `Carrier` is a rigid frame with the same history as a body (a cart, a held `Item`): its one mover moves it once per sub-step, **before** anything that reads it moves (a second move in a sub-step throws). Several bodies share a `World`; set `world.bodies` to each one's last pose (copies) before updating them, so the order they update in changes nothing.
