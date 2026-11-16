# Architecture

Six workspace packages. Dependencies point one way; a lower package never imports an upper one, not even as a type.

```
examples ──▶ @drawcall/animate ──▶ @drawcall/gait ──▶ @drawcall/plan ──▶ three
   │               ├──────────────▶ @drawcall/limbs ──▶ @drawcall/plan
   ├──────▶ @drawcall/hand ──▶ three        (hand and animate never import each other)
   └──────▶ @drawcall/debug ──▶ animate, gait, plan, hand   (a leaf: only pages import it)
```

| package | one responsibility |
| --- | --- |
| `@drawcall/plan` | A `Channel`: something with a place, a turn and a velocity that goes from frame to frame on the smoothest way from whatever state it is in. Frames are `{ at, place, velocity, turn, on, about }`; writing or cancelling them replans at once and continues from the current state; it pushes no harder than its strength and says how a frame came short; it can be bound to another channel, or moved from outside and only watched. Every moving thing in the body is a channel. |
| `@drawcall/gait` | The hips and the feet: a `Gait` whose hips and feet are channels whose frames it writes from a lead (`go`, `walk`, `run`, `face`, `jump`, `stand`), a stride clock and a pelvis. Its hips plan never reads the hands. |
| `@drawcall/limbs` | The rig's mechanics: `Bones` (the rig measured and posed), the joints and their ranges, a limb's reach (`Limb`), fingers. No planning. |
| `@drawcall/animate` | The one `Body` an author imports. The hands, feet and bound things are channels a story writes frames to; one clock steps the gait, then the ends, and poses the bones: the legs over the gait's feet, the arms by one solve (`solve.ts`) that also tells the planner how far a limb goes. |
| `@drawcall/hand` | Finger poses, and how a hand grips a mesh. |
| `@drawcall/debug` | One view a layer, drawn from that layer's own `intent()`: `plan`, `gait`, `hand`, `body`; a page turns layers on with `?debug=plan,gait,hand,body`. |

## How a step goes

`Clock.advance` (animate) is the only place the order is written:

1. things moved from outside are looked at; stories go on (they write frames);
2. the bound things' channels advance, then the gait steps (`Stride.step`: its hips and feet channels advance, and the posed hips are told);
3. the hands' and feet's channels advance;
4. the free parts react (trunk, head, free arms: `Stride.react`);
5. pose: the legs reach the gait's feet, the arms the hands' channels (`reachArm`), a thing the body moves is drawn where its leading hand has it.

Data flows one way: gait → hand and thing plans → posture (what the hands ask of the hips and trunk: sink, bend, turn, shift) → pose. A frame `on` him is counted on the gait's hips plan (`OnHim`), so a hand's plan never reads itself through the body.

## What each gives the layer above

Each `src/index.ts` exports only what the layer above imports.

- **plan → gait, limbs, animate, debug:** `Channel`, `Frame`, `Mover`, `cubic`, `hardest`, `between`, `State`.
- **gait → animate, debug:** `Gait` (its `hips` and `feet` channels, `lead`, `steps`, `put`, `hold`, `spares`, `when`, `highest`, `intent()`), `Size`, `Side`.
- **limbs → animate:** `Bones`, `joints`/`RANGE`, `Limb`, sizes and world helpers, finger `Pose`/`Grip` types.
- **animate → authors:** `Body` (with `bind`, `bound`, `cancel`, `stand`, `intent`, `gait`), `Hand`, `Foot`, `Thing`, and the types above.
- **debug → pages:** the layer views and `shown(location.search)`.

## The contract a plan keeps with the pose

The planner and the solver are one model of the body. A swing round where a limb starts sets off as the limb's own
range and strength let it (`End.leaves`, with `room` from the solve); a hand plans the part it was sent with, and the
solve puts that part there; a plan is never moved to where the pose ended up. A place on a thing the game carries with
him is read against his hips; one the game sets for the very moment is read in the scene.

## Still to fix

1. **Places on him miss the posture's sink.** The gait's hips plan carries no sink the hands ask for, so a swing
   round a shoulder he will get down for is planned round a standing shoulder (bowling's backswing).
2. **`stride.ts`** in animate still poses the legs, heels and free parts over the gait (373 lines); that belongs in
   the gait's own pose.
3. **No package tests of their own** but plan's: everything else is tested through a whole `Body` in
   `packages/animate/test`.
