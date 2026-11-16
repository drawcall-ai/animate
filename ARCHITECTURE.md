# Architecture

Five workspace packages. Dependencies point one way; a lower package never imports an upper one, not even as a type.
Examples import only `animate`, `hand` and `debug`.

```
examples ──▶ @drawcall/animate ──▶ @drawcall/gait ──▶ @drawcall/plan ──▶ three
   ├──────▶ @drawcall/hand ──▶ three        (hand and animate never import each other)
   └──────▶ @drawcall/debug ──▶ animate, gait, plan, hand   (a leaf: only pages import it)
```

| package | one responsibility |
| --- | --- |
| `@drawcall/plan` | A `Channel`: something with a place, a turn and a velocity that goes from frame to frame on the smoothest way from whatever state it is in. Frames are `{ at, place, velocity, turn, on, about }`; writing or cancelling them replans at once and continues from the current state; it pushes no harder than its strength and says how a frame came short; it can be bound to another channel, or moved from outside and only watched. Every moving thing in the body is a channel. |
| `@drawcall/gait` | The hips and the feet: a `Gait` whose hips and feet are channels whose frames it writes from a lead (`go`, `walk`, `run`, `face`, `jump`, `stand`), a stride clock and a pelvis. Its hips plan never reads the hands. It also holds the words of the legs the body shares (`Side`, `SIGN`, the sole and the heel, `Size` of the legs). |
| `@drawcall/animate` | The body, and the one `Body` an author imports. `rig/` is its mechanics: `Bones` (the rig measured and posed), the joints (`Goal`: an angle sent, followed or free, within its range), their strengths and ranges, a limb's reach (`Limb`), fingers. The hands, feet and bound things are channels a story writes frames to; one clock steps the gait, then the ends, and poses the bones: the legs over the gait's feet (`legs.ts`), the free parts reacting (`free.ts`), the arms by one solve (`solve.ts`) that also tells the planner how far a limb goes. |
| `@drawcall/hand` | Finger poses, and how a hand grips a mesh. |
| `@drawcall/debug` | One view a layer, drawn from that layer's own `intent()`: `plan`, `gait`, `hand`, `body`; a page turns layers on with `?debug=plan,gait,hand,body`. |

## How a step goes

`Clock.advance` (animate) is the only place the order is written:

1. things moved from outside are looked at; stories go on (they write frames);
2. the bound things' channels advance, then the gait steps (`Legs.step`: its hips and feet channels advance, and the posed hips are told);
3. the hands' and feet's channels advance;
4. the free parts react (trunk, head, free arms: `Free.react`);
5. pose: the legs reach the gait's feet, the arms the hands' channels (`reachArm`), a thing the body moves is drawn where its leading hand has it.

Data flows one way: hand and thing plans → posture (how far he bends, turns, rolls the trunk and lets the hips down for every hand to reach where it is planned: `Reach.lean`, against the hips' plan) → the gait's hips plan (it writes the sink into its frames, reading it before it rewrites them) → pose. A frame `on` him is counted on that hips plan (`OnHim`), so a hand's plan never reads itself through the body.

## What each gives the layer above

Each `src/index.ts` exports only what the layer above imports.

- **plan → gait, animate, debug:** `Channel`, `Frame`, `Mover`, `Xyz`, `cubic`, `hardest`, `between`, `State`.
- **gait → animate, debug:** `Gait` (its `hips` and `feet` channels, `lead`, `steps`, `put`, `hold`, `spares`, `when`, `highest`, `intent()`), `Size`, `Side`, and the shared words of the legs (`SIDES`, `SIGN`, `SOLE`, `HEEL`, `raised`, `UP`, `GRAVITY`, `clamp`, `wrap`).
- **animate → authors:** `Body` (with `bind`, `bound`, `cancel`, `stand`, `intent`, `gait`), `Hand`, `Foot`, `Thing`, and the types above.
- **debug → pages:** the layer views and `shown(location.search)`.

## The contract a plan keeps with the pose

The planner and the solver are one model of the body. `Reach` (`reach.ts`) is what the arms with the trunk reach:
from where the hips are planned and how he faces, the least lean (trunk bent, turned, rolled, as far as its joint
goes; hips let down to a full squat), each part going the same share of the way it has left, that has every hand's arm
reach its place, no further behind him than an upper arm swings back. The posture is its answer for the hands' plans
(now, and eased in before where they are to arrive); the planner plans every hand frame within it (`End.within`: a frame
it cannot meet is brought as near as the arms reach unstretched and marked `short`; a place on him is planned within
reach of him standing; a grip on a thing is never moved, the body leans for it). A swing round where a limb starts sets
off as long before as three times the way round its pivot at the speed it arrives with, comes no nearer the pivot than
half the limb and swings on to rest within its reach; a hand given back turns its joints no faster than it moved. A
hand plans the part it was sent with, and the solve puts that part there; a plan is never moved to where the pose
ended up. The hips are where the gait plans them: the posture lets them down through the gait's plan, never shifts them.

## Still to fix

1. **The arm's solve still searches its swivel** (`reachArm`), apart from `Reach`: the reach function knows where the
   shoulder must be, not how the elbow swings; the hands' default turn (`along`) is the reach's answer for a wrist at
   rest only approximately.
2. **The swing round a moving shoulder** measures where it sets off from the shoulder as it is at the moment asked
   (see the gait log): counting it from the shoulder at set-off keeps a plan on a jumping body, but the hand-over to
   the free arm after a release then needs the same care.
3. **No package tests of their own** but plan's: everything else is tested through a whole `Body` in
   `packages/animate/test`.
