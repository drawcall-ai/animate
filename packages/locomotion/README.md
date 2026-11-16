# @drawcall/locomotion

One locomotion planner for a humanoid on [`@drawcall/ik`](../ik). Each frame it is told where the body should be and how it moves (a physics capsule, say) and returns this frame's goals; the solver poses the body. Plain code, one function, no modes.

```ts
import { createLocomotion } from "@drawcall/locomotion"

// how fast the capsule's velocity turns into the desired one, and how high a step it gets up without a jump
const planner = createLocomotion(body, { acceleration: 35, climb: 0.32 })
function frame(dt: number) {
  const goals = planner.step(dt, {
    position: capsule.position, // the point on the ground under the body
    velocity: capsule.velocity,
    desired: input, // the velocity asked for: the planner predicts with it
    grounded: capsule.grounded,
    crouch: 0.4, // 0..1
    ground: (at) => heightUnder(at), // a ray cast down, per foot: stairs
    taken: ["armL", "armR"], // a rifle has the arms: the planner emits nothing for them
  })
  solve(body, [...goals, ...rifleGoals], dt)
}
planner.jump(() => capsule.jump()) // the knees bend, then the capsule is sent up; committed until it lands
planner.plant("L", spot, 0.7) // "this foot planted here 0.7 s from now": true if that fits, false (and nothing changes) if not
```

Parts that can be taken: `armL`, `armR`, `head`, `trunk`. `facing` (a yaw) makes the body face something other than where it goes.

## How it works

There are no gaits. A planted foot stays where it is (the only hard goals) until the pelvis has travelled past it by the leg's reach, then swings to land ahead of where the pelvis will be when it lands, on the ground under that spot. That one rule is the whole range:

- **Walk, run, sprint.** Slowly, the other foot is down long before a foot has to leave. Above about 2 m/s the pelvis outruns the planted foot before the swinging one has landed, so it leaves anyway: the flight phase of a run. A runner lands nearly under himself and is in the air up to 0.1 s longer per stride; step length and cadence follow (see the numbers). Left and right take turns evenly: a foot that left too soon after the other stays in the air until half a stride after the other lands, so a disturbed run finds its rhythm again within a stride.
- **The foot rolls.** In a walk it lands on the heel with the toes up, comes down flat, and leaves over the ball with the heel up; a run lands on the ball. What is planted is that one point of the foot, so nothing slides while the rest turns about it. In the swing the heel comes up behind and the foot comes forward low.
- **Stopping, turning, turning around.** The landing spot is under the predicted body, so while the capsule brakes a foot lands ahead of it (the braking step), and once it comes back the next lands behind (the push-off). The pelvis turns to face where it goes, but no further from a planted foot than the hip allows: a turn takes steps, and below a run they are steps, not hops.
- **Only where the body can go.** No foot is put on ground higher above the body than `climb`, the step the capsule gets up without a jump: such a spot is pulled back towards the body. Held back by something (the velocity does not turn into the desired one), the planner stops believing the input and stands.
- **Crouch** lowers the pelvis and shortens the reach. **Stairs**: a landing spot is nudged onto one tread and the foot stands at the height the caller's ray finds there; the swing clears the difference, the pelvis rides over the feet.
- **Jump and fall**: a jump goes down with the arms back (0.22 s), stretches up onto the toes and throws the arms up (0.1 s), and only then is the capsule sent up. Off the ground nothing is planted: the legs hang stretched with the toes pointed, the arms come down as it falls, the feet flatten for the ground just before it comes, and both are planted where they land while the knees take the fall (a spring on the pelvis height, the trunk bowing with it).

**The pelvis carries the gait.** It is a strong soft goal on the capsule (weight 100; a swinging foot has 30). In a walk it rides up over the standing leg and to its side, that hip higher, and is lowest with both feet down; in a run it sinks into the stance and rises through the flight. It tilts with each step, turns with the stride, leans with the speed and into every acceleration, and banks into a turn. The posture gives the trunk its share of the lean, turns and tilts the chest against the pelvis, keeps the head level, and swings the arms against the legs, elbows bent more the faster it goes.

**Commitment.** A foot in the air lands when it was going to. Its spot follows the prediction until 0.12 s before, then stays, unless the body has left it beyond the leg's reach. A jump is committed from the launch to the ground. A request (`plant`) fixes its spot from the start.

**The trade-off** is in two numbers: the weight of the pelvis goal (how hard the body is held to the capsule) and `LIMIT`, how far a leg stretches before the foot leaves the ground. A capsule can do what no body can (35 m/s^2); the planted feet never slide, so what gives is the pelvis. The 2 to 3 cm the pelvis is off the capsule in a walk is its sway over the standing leg, on purpose.

Lengths are for a pelvis 0.98 m over the soles and scale with the body's own.

## Numbers (`pnpm test`, 60 fps)

The planner alone, following a point that turns its velocity at 35 m/s^2:

| speed   | step length | cadence  | in flight | pelvis off (mean / max) | foot slide | max joint change per frame |
| ------- | ----------- | -------- | --------- | ----------------------- | ---------- | -------------------------- |
| 0.7 m/s | 0.35 m      | 120 /min | 0 %       | 1.4 / 2.3 cm            | 2e-15 m    | 0.46 rad                   |
| 1.4 m/s | 0.62 m      | 135 /min | 0 %       | 2.2 / 3.3 cm            | 4e-15 m    | 0.41 rad                   |
| 2.5 m/s | 0.91 m      | 165 /min | 23 %      | 1.4 / 2.3 cm            | 5e-15 m    | 0.31 rad                   |
| 3.5 m/s | 1.27 m      | 165 /min | 47 %      | 0.7 / 1.2 cm            | 1e-14 m    | 0.32 rad                   |
| 6.0 m/s | 1.85 m      | 195 /min | 65 %      | 0.5 / 0.9 cm            | 1e-14 m    | 0.46 rad                   |

Foot slide is measured at the point of the foot that is on the ground. A foot 0.1 s from the ground when the input turns around lands on its time and its spot (0 m off). A foot asked for 0.7 s ahead while walking stands on the spot at that time; asked for 0.05 s ahead, or 3 m out of reach, the planner says it cannot. With the arms taken, every arm joint has weight 0. Walking past a 0.4 m kerb under one foot's way, a planner told the body climbs anything plants a foot on it; told it climbs 0.3 m, none. Stopped dead by a wall from 3.5 m/s with the input still pushing, the last foot is down 0.3 s later.

The controller example measures it on a physics capsule, the match example under a stroke planner.

## Limits

- **Single-frame jumps remain under the hardest input.** Turning around at a sprint, reversing every 0.5 s, running onto stairs or a random stick, one joint (mostly a knee) turns 1 to 2.5 rad in a frame a few times a minute: a leg that reached for the ground nearly straight folds as the foot is planted, or a leg at its end is let go. Steady gaits stay at or below 0.5 rad per frame.
- **No dynamics**: the lean, the sway and the rise and fall are rules, not balance.
- **Level treads only**: the foot stands at the height the ray found; slopes are not looked at. In the air the landing is predicted for the height it left from.
- Not there yet: a taken leg (a kick), strafing and backpedalling styles (they work through `facing`, without a look of their own).
