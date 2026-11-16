# @drawcall/ik

Goal-driven whole-body inverse kinematics on three.js bones. Each frame you hand the solver a list of goals and it computes one pose that meets the hard goals exactly (as far as reachable) and the soft goals as well as possible. Goals have no time in them and the solver keeps nothing between frames: whoever plans rebuilds the list every frame.

```ts
import { balance, createHumanoid, upright } from "@drawcall/humanoid" // any Body will do: this one is a humanoid
import { hard, mark, posture, solve, Target } from "@drawcall/ik"
import { Object3D, Vector3 } from "three"

const body = createHumanoid() // three.js Bones; body.root goes into your scene
scene.add(body.root)

const racket = new Object3D()
body.attach(racket, mark(body.get("handR"), "hold", new Vector3(0, -0.08, 0)))
const sweet = mark(racket, "sweet", new Vector3(0, 0.5, 0)) // a point on the racket
const ball = new Target() // a point in the world, moved by the planner

function frame(dt: number) {
  ball.set({ position: whereTheBallIs, velocity: howTheRacketShouldMove })
  const result = solve(
    body,
    [
      hard(body.get("soleL"), leftFootTarget),
      hard(body.get("soleR"), rightFootTarget),
      hard(sweet, ball), // the sweet spot is at the ball, moving as asked
      balance(body, 2), // balance is an ordinary soft goal: soft(body.centre, a point over the feet)
      posture(body, upright(body)), // so is the rest pose
    ],
    dt,
  )
  // result.goals[2] = { missedBy, reachable }: how far the sweet spot is from the ball, and whether it got there
}
```

## Concepts

**Body.** The three.js scene graph is the kinematic tree. A bone becomes a joint with `joint(bone, hinges)`; `new Body(root)` collects them, the root being the floating base. A point is any `Object3D`: under a bone or an attached object it is a point on the body (`mark(parent, name, position, quaternion)` makes one, `body.get(name)` finds bones and points), anywhere else it is a point in the world. `body.centre` is the centre of mass as a point. `body.attach(object, hold, grip?)` attaches an object rigidly so that its `grip` frame coincides with the point `hold`: the first attachment parents it there, a second one closes a loop (a rifle in both hands), which the solver keeps as a hard goal. `body.detach(object, from?)` lets go.

**Goal.** `hard(a, b)` and `soft(a, b, weight?)`: point `a` should match point `b`. Either may be on the body, on something attached, or in the world, and both may move with the pose: "the left hand on the racket the right hand holds" is `soft(palmL, markOnRacket)`, differentiated exactly.

What is matched is what `b` carries. A plain `Object3D` carries its position and rotation. A `Target` (an `Object3D` with `set`) carries what it was last given: `target.set({ position, quaternion, velocity, axes })`, any combination, all respected in the same solve. A velocity is in world space and is met as a backward difference over the frame's `dt`. `axes` weights the world axes of the position and velocity rows, e.g. `(1, 0, 1)` for horizontal only.

Hard means hard. A hard goal has no weight; two hard goals on the same point in one solve throw. A hard goal that cannot be reached leaves the closest pose and is reported, never silently traded against a soft goal. `posture(body, pose, weight?)` is the soft goal on the joints themselves (a rest pose, or part of one: bones a pose leaves out are free to do the work). A goal on joints can also be written directly: `{ joints: body.q.slice(), weights, weight }` asks the pose to stay near the one it is in.

There is no time, no activation window and no ownership inside a goal. A goal that should fade is a soft goal whose weight the planner changes; a goal that should stop is left out of the next frame's list.

**Solver.** `solve(body, goals, dt?, options?)` writes the bones and returns `{ iterations, converged, goals, closureError, limits }` with one `{ missedBy, reachable }` per goal in the order given (`missedBy` in metres or radians, whichever residual is largest). `maxIterations: 0` only evaluates the goals at the current pose. The pose it starts from is the body's current pose.

**State.** For planners: `body.positionOf(point)`, `body.rotationOf(point)`, `body.velocityOf(point)` (the velocity the last solve produced, by difference), for any point including `body.centre`.

**Trajectory helpers** (pure functions, nothing the solver knows about): `ease(x)`, `bump(x)`, `keyed(times, values)` (a smooth curve through timed values), `toward(p0, v0, p1, v1, time)` (the curve from a current position and velocity to a future position and velocity; evaluate it one frame ahead, every frame, to replan continuously), `mixPose(a, b, u)`.

## Method

Newton's method on one objective, `F(q) = 1e6 * f_hard(q) + f_soft(q)` with `f = 1/2 * sum(w * |target - point(q)|^2)`, iterated to convergence inside the frame, followed by two Gauss-Newton steps on `f_hard` alone that project the pose exactly onto the hard goals. Joints are sequences of hinges, so Jacobians and second derivatives are closed-form cross products.

Damped least squares with null-space projection was tried first. For reachable hard goals the two give the same step. For unreachable ones the first-order method fails: the goal leaves a residual, directions that look free to first order (bending a fully stretched arm) are actually stiff, the null space hands them to the soft goals, and the pose 2-cycles. The Hessian here therefore includes the geometric term `sum(r_i * Hessian(e_i))`, where for hard goals `r` is the force the goal carries (as in SQP). Convergence is quadratic, about 5 iterations and 1.5 to 2 ms per frame for the 48-DOF body of `@drawcall/humanoid`. Joint limits are an active set.

## Test numbers (`pnpm test`, 60 fps)

| case | result |
| --- | --- |
| hard hand goal on a target moving at up to 0.75 m/s | missed by 9e-16 m (one frame of lag would be 1.2e-2 m) |
| box gripped by both hands while the pelvis walks, bobs and turns | both grips within 3e-15 m; soft "box at the chest marker" within 1.2 cm |
| racket on the hand, hard sweet-spot position and orientation | 1.2e-15 m |
| unreachable hard hand goal, static | missed by 0.402 m and reported unreachable; the planted feet give 0.21 m (see limits); max frame-to-frame joint change 2e-10 rad; 0 of 2000 random nearby poses do better |
| target sweeping in and out of reach | unreachable in 490 of 1261 frames; up to 1.6 rad per frame where it crosses the reach boundary |
| two hard goals on one point | throws |
| position and velocity on one target (`toward`, replanned every frame) | both met to 5e-16 m per frame |
| velocity-only hand goal | velocity error 4e-14 m/s |
| same goals reached from the past and from the future | max joint difference 2e-15 rad |

The tests run on the body of `@drawcall/humanoid`. The soldier, tennis, match and controller examples have their own tests.

## Known limits

- **Local optimum.** The solver returns the nearest local optimum to its seed. Soft goals are not convex, so the pose can switch to another optimum within one frame.
- **Reach boundary.** Where a hard target crosses the edge of reach, exact IK has a square-root singularity: the pose is continuous but changes without bound in speed, and with the arms left out of the posture the trunk commits and lets go abruptly. The solver does not smooth this. Keep hard targets away from the boundary, or make them soft before they get there.
- **Conflicting hard goals share the conflict equally** (least squares among them; there are no hard weights). A hand asked to be 0.4 m beyond reach pulls planted feet off their marks. A planner that wants the feet to win must not ask the hand for the impossible, or must make the hand soft.
- **Jams.** With several hard goals on one limb the nearest optimum can be a pose with the limb locked against its joint limits, and the solver stays there. The match example makes only the racket's sweet spot hard, the hand's place soft, and adds a soft goal to stay near the current pose.
- **Posture comes with the goals.** There is no built-in comfort. Bones a pose lists share a deviation among themselves; an order exists only between listed and left-out bones (those get 3% of the pull).
- **One point, one set of things carried.** A point that is hard in position and soft in rotation needs two targets and two goals.
- **Velocity** is a backward difference against the pose before the solve, `p = p(before) + v * dt`: it needs `dt`, and is linear only. On a target that also carries a position the two rows say the same thing when the planner is consistent, and fight when it is not.
- **`missedBy` of a posture** is its largest joint deviation, which says little.
- **Joints are Euler hinges with box limits**, independent unless a hinge gives a `range` (its limits as a function of the bone's own angles, read once per solve at the pose it starts from, so they lag a fast move by a frame): a ball joint loses a degree of freedom where two of its hinges line up (a shoulder with the arm straight out sideways), and there is no self-collision.
- **A joint on a limit where the limb is straight can stay there** (a knee locked straight under a pelvis that should come down): keep such limits off the straight pose, as `@drawcall/humanoid` does for the knee.
