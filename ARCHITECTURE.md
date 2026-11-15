# Architecture

Five workspace packages. Dependencies point one way only; a lower package never imports an upper one, not even as a
type.

```
examples ──▶ @drawcall/animate ──▶ @drawcall/locomotion ──▶ @drawcall/limbs ──▶ three
   │                 └──────────────────────────────────────────▲
   ├───────▶ @drawcall/hand ──▶ three        (hand and animate never import each other)
   └───────▶ @drawcall/debug ──▶ @drawcall/animate, three   (a leaf: nothing imports it but pages)
```

| package | one responsibility | lines |
| --- | --- | --- |
| `@drawcall/limbs` (`packages/limbs`) | The rig's bones and the joints that turn them, and planning the end of a limb to a place at a moment, as near as the body can. | 3,500 |
| `@drawcall/locomotion` (`packages/locomotion`) | The hips and the feet under them: which foot steps where and when, the pelvis over the feet, and the free trunk and arms reacting, as a story or the player has him go. | 2,950 |
| `@drawcall/animate` (`packages/animate`) | Brings the two together as the one `Body` an author imports, steps it on one clock, and holds the skill. | 490 |
| `@drawcall/hand` (`packages/hand`) | Finger poses, and how a hand grips a mesh. | |
| `@drawcall/debug` (`packages/debug`) | Draws what the bodies in a scene mean to do over it, beside what they do (`Intent`, an `Object3D`, and its `legend()`), from `Body.intent()` alone. | 520 |

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
- `Bindings`: the things bound to the hands, which go with them (see below).
- `Gives`: the old held-thing solver, going away (see blurred boundaries).
- the types `animate` re-exports to authors: `Finger`, `Grip`, `Part`, `Pose`, `Side`, `Size`, `Story`, `Touch`, `Xyz`.

**locomotion → animate**
- `Mover` (hips and feet), `Ahead` (him looked ahead along), `carrier(mover, ahead)` (the `Carrier` for the planner),
  `Going` (the movement intention: walk, run, go, face, look, knock, jump, stand) with `Ground`, `Run`, `Walk`, `flat`,
  `Reactions`, `Stance`, `Stoops`, `held`.

**animate → authors**: `Body` (with `bound`), `Held` (going away), `Foot`, `Hand` (with `take` and `letGo`), and the types above. `Foot` and
`Hand` are declared in `animate/src/ends.ts`, where a place `on` him can be typed as the `Body`.
`Body.intent()` tells what he means to do as plain data (`Intent`: each end's `Aim` from `Planner.aim()` in limbs,
the hips and footfalls `foresee`n by locomotion on a copy of `Mover`, and where each held thing is meant to be),
told only when asked and changing nothing of him; `Body.of(rig)` finds the body made for a rig. `@drawcall/debug`
draws only that.

## Inside limbs

`world`, `size`, `curve`, `goal` → `bone`, `bones`, `shape`, `fingers`, `limb`, `joints` → `track` (where a target
is) → `reach` (how the limb turns to it) → `planner` (when it sets off, how it swings) → `end` (carrying the plan out).
`binding` sits above them: it reads where the posed bones put the hands, writes the bound things there after every
pose, and knows an `End` only by its `side`, `name`, `follows` (the things it is sent onto) and `free`. The planner
knows nothing of it: a hand sent `with: grip` is counted from the grip, and one sent onto a thing follows it, as
before. `give` (going away) sits beside the planner and is used by `track` and `end`.

## Blurred boundaries still to fix

1. **Held things still run through the planner, for `body.hold`.** Bindings (`limbs/src/binding.ts`, `hand.take`,
   `hand.letGo`) replace it; basketball and the shelf use them. Once no example uses `body.hold` (bowling, javelin,
   tennis, fencing, gladiator, patrol, the rifleman and the shooter still do, through `holds` in
   `examples/character.ts`), delete:
   - limbs: `give.ts` whole, and `Gives` from `index.ts`;
   - `End`: `holding`, `placed`, `keeps`, `leads`, `nearest`, `wants`, `turning`, `posed`, `carry`, `letGo`, `takes`,
     `take`, and the `gives`/`carries` branches of `on`, `send` (the held-there check and the take), `arrive` (the
     `gives` there and the `plan.gives` stoop rule), `advance` (`kept`, `bend`, the `gives` aim) and `leave`;
   - `Track`: `Target.gives/carries/pose`, `Rigged.held`, the `gives` branch of `where` and of `target`, `carrying`
     with `Carrying` and its helpers `basis`, `shortest`, `rolled`; `Planner.scan`'s `target.gives` branch;
   - animate: `Body.hold`, `Held`, `POCKET`, `gives` and `rigged.held` in `body.ts`; `gives.begin/correct/write` in
     `clock.ts`; the `holding` loop in `intent.ts`;
   - examples: `holds` in `character.ts` (use `inHand`), and the `body.hold` tests in `hold.test.ts`.
   One thing `Gives` does that bindings do not yet: `body.look(place, { over, on })` slides a rifle along the line
   from the eye (`gives.correct` feeding `reactions.sights`), and a resting stock sits in the shoulder's pocket. The
   rifle's conversion needs those as a statement of their own (a hand sent so the sight is on the line, or a
   `Carrier` request), not a solver.
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
