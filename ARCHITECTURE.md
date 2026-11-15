# Architecture

Five workspace packages. Dependencies point one way only; a lower package never imports an upper one, not even as a
type.

```
examples ──▶ @drawcall/animate ──▶ @drawcall/locomotion ──▶ @drawcall/limbs ──▶ three
   │                 └──────────────────────────────────────────▲
   ├───────▶ @drawcall/hand ──▶ three        (hand and animate never import each other)
   └───────▶ @drawcall/debug ──▶ @drawcall/animate, @drawcall/hand, three   (a leaf: nothing imports it but pages)
```

| package | one responsibility | lines |
| --- | --- | --- |
| `@drawcall/limbs` (`packages/limbs`) | The rig's bones and the joints that turn them, and planning the end of a limb to a place at a moment, as near as the body can, and the things bound to him. | 3,170 |
| `@drawcall/locomotion` (`packages/locomotion`) | The hips and the feet under them: which foot steps where and when, the pelvis over the feet, and the free trunk and arms reacting, as a story or the player has him go. | 2,950 |
| `@drawcall/animate` (`packages/animate`) | Brings the two together as the one `Body` an author imports, steps it on one clock, and holds the skill. | 700 |
| `@drawcall/hand` (`packages/hand`) | Finger poses, and how a hand grips a mesh. | |
| `@drawcall/debug` (`packages/debug`) | One view for each layer, each an `Object3D` to add to the scene: what the bodies in it mean to do, beside what they do (`Intent` and its `legend()`, from `Body.intent()` alone), and why each grip came out as it did (`Grips`, from `Body.bound` and the `Grip` data of `@drawcall/hand`: what was asked, each element's contact, how far from holding). | 660 |

## What each gives the layer above

Each package's `src/index.ts` exports only what the layer above imports. Add to it only when an upper layer needs a name.

**limbs → locomotion and animate**
- the body's mechanics: `Bones` (the rig, measured, posed), `joints`/`Joints`/`parts`, `Goal` (a part with a
  strength), `Limb`, `RANGE`, `LAGS`, `TRAIL`, `ANKLE`, `SLACK`, `sway`, `cubic`, `State`, `AXES`, `EASY`, `REST`, and
  the units and helpers of `size.ts` and `world.ts`.
- the limb planner: `End` (a foot or a hand sent to a place, planned and carried out step by step), with its
  `Reaching` and `Arriving`.
- `Carrier` and `Stoop`: **the one interface the planner sees of the rest of the body** (where a limb will start
  from, where a foot the body steps with will be and whether it is spared, getting down, winding up, taking and putting
  a foot). limbs declares it; locomotion implements it. The planner never sees `Mover` or `Ahead`.
- `Bindings`: the things bound to him and the hands on them (see below).
- the types `animate` re-exports to authors: `Finger`, `Grip`, `Part`, `Pose`, `Side`, `Size`, `Story`, `Touch`, `Xyz`.

**locomotion → animate**
- `Locomotion`, made from the rig's `Bones` and `Joints`: it owns the hips and feet (`Mover`), the look-ahead
  (`Ahead`), the free parts' reactions, the legs' stances and the movement intention. animate says where he goes
  through its `going` (`Going`: walk, run, go, face, look, knock, jump) and `stand(free)`, hands the planner its
  `carrier`, steps it with `step(dt, feet, looked)` (telling a wind-up to play), `react(dt, sights)`,
  `pose(delta, feet)` and `tread(side, foot, delta)`, and reads `hips`, `facing`, `ground`, `stands(side)`, `posed()`
  and, for the intent, `foresee(seconds)`. With it `Ground`, `Run`, `Walk`, `flat`, and the types `Footfall`,
  `Foreseen`.

**animate → authors**: `Body` (with `bind` and `bound`), `Thing` (a thing bound to him: `on`, `off`, `to`, `by`,
`free`, `outside`), `Foot`, `Hand`, and the types above. `Foot` and
`Hand` are declared in `animate/src/ends.ts`, where a place `on` him can be typed as the `Body`.
`Body.intent()` tells what he means to do as plain data (`Intent`: each end's `Aim` from `Planner.aim()` in limbs,
the hips and footfalls `foresee`n by locomotion on a copy of `Mover`, and where each held thing is meant to be),
told only when asked and changing nothing of him; `Body.of(rig)` finds the body made for a rig. `@drawcall/debug`
draws only that, and the grips.

## Inside limbs

`world`, `size`, `curve`, `goal` → `bone`, `bones`, `shape`, `fingers`, `limb`, `joints` → `track` (where a target
is) → `reach` (how the limb turns to it) → `planner` (when it sets off, how it swings) → `end` (carrying the plan out).
`binding` sits above them. A thing moved by the body is the end of its leading hand's chain, offset by the grip (a
tool frame): `thing.to/by` is that hand's send `with: grip`, so the planner plans a thing exactly as it plans a hand,
and `binding` writes the thing where the posed hand has it after every pose (turning with it, or by a point keeping
its own turn or turning as sent). Every other hand on it is sent onto its grip and follows it, one way. A thing moved
from outside is never written; every hand on it follows it. `binding` knows an `End` only by its `side`, `name`,
`follows`, `there`, `last`, `to`, `pin` (a follower set each step where it has it on the thing: derived, not planned)
and `free`; the planner knows nothing of it. A bound thing that turns by a point keeps its turn against the way he
faces.

## Blurred boundaries still to fix

1. **The step is ordered in two halves.** animate builds one `Locomotion` and orders the step: ends arrive, stories
   go on, `locomotion.step`, ends advance, joints advance, `locomotion.react`, `locomotion.pose`, bones are posed. The
   feet ends are passed in where a step needs them, because they are made from locomotion's `Carrier` and so after
   it. What is left: reactions still come after the joints advance, so locomotion is entered twice a step.
2. **The planner talks back to locomotion.** Through `Carrier.stoop`, `rise`, `wind`, `take` and `put` the planner
   changes where the hips go (getting down, winding up, the story taking a foot). The direction of imports is right,
   but it is a two-way conversation, not a query; keep any new request on `Carrier`, never a direct import.
3. **Scripted and led stepping share `Mover` through flags.** `Mover.advance` branches on `led`, `placed` and `jumps`
   into `stride` (led, by `Steps`) or the scripted `tread`/`next`/`place`. Both are locomotion, so no package is
   crossed; fix: two steppers behind one interface.
4. **No package tests of its own.** All tests drive a whole `Body` (and the examples), so all stay in
   `packages/animate/test`; limbs and locomotion have none. A test that reaches past `@drawcall/animate` imports from
   `@drawcall/limbs`, never a `src` path.
