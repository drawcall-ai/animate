# Architecture

Four workspace packages. Dependencies point one way only; a lower package never imports an upper one, not even as a
type.

```
examples ──▶ @drawcall/animate ──▶ @drawcall/locomotion ──▶ @drawcall/limbs ──▶ three
   │                 └──────────────────────────────────────────▲
   └───────▶ @drawcall/hand ──▶ three        (hand and animate never import each other)
```

| package | one responsibility | lines |
| --- | --- | --- |
| `@drawcall/limbs` (`packages/limbs`) | The rig's bones and the joints that turn them, and planning the end of a limb to a place at a moment, as near as the body can. | 3,500 |
| `@drawcall/locomotion` (`packages/locomotion`) | The hips and the feet under them: which foot steps where and when, the pelvis over the feet, and the free trunk and arms reacting, as a story or the player has him go. | 2,950 |
| `@drawcall/animate` (`packages/animate`) | Brings the two together as the one `Body` an author imports, steps it on one clock, and holds the skill. | 490 |
| `@drawcall/hand` (`packages/hand`) | Finger poses, and how a hand grips a mesh. | |

## What each gives the layer above

Each package's `src/index.ts` exports only what the layer above imports. Add to it only when an upper layer needs a name.

**limbs → locomotion and animate**
- the body's mechanics: `Bones` (the rig, measured, posed), `joints`/`Joints`/`parts`, `Goal` (a part with a
  strength), `Limb`, `RANGE`, `LAGS`, `TRAIL`, `ANKLE`, `SLACK`, `sway`, `cubic`, `State`, `AXES`, `EASY`, `REST`, and
  the units and helpers of `size.ts` and `world.ts`.
- the limb planner: `End` (a foot or a hand sent to a place, planned and carried out step by step), with its
  `Reaching`, `Arriving` and `Carrying`.
- `Carrier` and `Stoop`: **the one interface the planner sees of the rest of the body** (where a limb will start
  from, where a foot the body steps with will be and whether it is spared, getting down, winding up, taking and putting
  a foot). limbs declares it; locomotion implements it. The planner never sees `Mover` or `Ahead`.
- `Gives`: the held-thing solver (see blurred boundaries).
- the types `animate` re-exports to authors: `Finger`, `Grip`, `Part`, `Pose`, `Side`, `Size`, `Story`, `Touch`, `Xyz`.

**locomotion → animate**
- `Mover` (hips and feet), `Ahead` (him looked ahead along), `carrier(mover, ahead)` (the `Carrier` for the planner),
  `Going` (the movement intention: walk, run, go, face, look, knock, jump, stand) with `Ground`, `Run`, `Walk`, `flat`,
  `Reactions`, `Stance`, `Stoops`, `held`.

**animate → authors** (unchanged by the split): `Body`, `Held`, `Foot`, `Hand`, and the types above. `Foot` and
`Hand` are declared in `animate/src/ends.ts`, where a place `on` him can be typed as the `Body`.

## Inside limbs

`world`, `size`, `curve`, `goal` → `bone`, `bones`, `shape`, `fingers`, `limb`, `joints` → `track` (where a target
is) → `reach` (how the limb turns to it) → `planner` (when it sets off, how it swings) → `end` (carrying the plan out).
`give` sits beside them and is used by `track` and `end`.

## Blurred boundaries still to fix

1. **Held things run through the planner.** `give.ts` (`Give`, `Gives`) lives in limbs, and `End` (`holding`,
   `placed`, `keeps`, `leads`, `nearest`, `wants`, `turning`, `posed`, `carry`, `letGo`, `takes`, `take`, and the
   `gives`/`carries` branches of `on`, `send`, `arrive`, `advance`), `Track` (`Target.gives/carries/pose`, the `gives`
   branch of `where`, `carrying`, `gripped`, `Rigged.held`) and `Planner.scan` all know it. Fix: directed bindings
   (the next task) as their own module above the planner; then delete `give.ts` and every member listed here. A hand
   following a thing needs nothing new: `End` already keeps to a place `on` an `Object3D`.
2. **The step loop reaches into locomotion's workings.** `animate/src/clock.ts` and `body.ts` build `Mover`, `Ahead`,
   `Reactions`, `Stance` and `Going` one by one and step them field by field (`mover.look`, `mover.local`,
   `mover.course`, `mover.height`, `mover.advance`, `mover.fault`, `ahead.at`, `ahead.wind.start`, `stance.pose`,
   `reactions.react`, `held`). That is why locomotion exports its classes rather than one small surface. Fix: one
   `Locomotion` object owning those, with a `step(dt)` and the hips' pose and the feet as outputs; animate then only
   orders the step: ends arrive, stories go on, locomotion steps, ends advance, joints advance, bones are posed.
3. **The planner talks back to locomotion.** Through `Carrier.stoop`, `rise`, `wind`, `take` and `put` the planner
   changes where the hips go (getting down, winding up, the story taking a foot). The direction of imports is right,
   but it is a two-way conversation, not a query; keep any new request on `Carrier`, never a direct import.
4. **Scripted and led stepping share `Mover` through flags.** `Mover.advance` branches on `led`, `placed` and `jumps`
   into `stride` (led, by `Steps`) or the scripted `tread`/`next`/`place`. Both are locomotion, so no package is
   crossed; fix: two steppers behind one interface.
5. **No package tests of its own.** All tests drive a whole `Body` (and the examples), so all stay in
   `packages/animate/test`; limbs and locomotion have none. A test that reaches past `@drawcall/animate` imports from
   `@drawcall/limbs`, never a `src` path.
