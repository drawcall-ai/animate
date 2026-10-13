# prohuman next: design contract

This is the contract every part of the rewrite builds against. If you find it wrong, say so with
evidence and propose a change rather than working around it silently.

## Goal

Rebuild prohuman as:

1. a generic articulated-body core that knows nothing about humans, and
2. a humanoid package of behaviours written as `@pmndrs/timeline@0.4.0` synchronous timelines,

then recreate all 26 example scenarios on it, judged by the existing metrics suite.

The old core (`packages/core`) stays untouched as the reference: read it, reuse leaf code from it by
copying with attribution in a comment when useful, never import from it in the new packages.

## Packages

```
packages/body       @prohuman/body      generic: skeleton, state, proposal board, merge, solver, Body (steps one timeline)
packages/humanoid   @prohuman/humanoid  rig adapter (viverse model ⇄ skeleton), humanoid profile, humanoid() bundle,
                                        procedures, behaviours, world queries (affordances), metrics adapter
apps/examples       src/next/…          the 26 scenarios as timelines + headless harness running the existing metrics
```

Dependencies: `body` → `three`, `@pmndrs/timeline@^0.4.0`. `humanoid` → `body`, `three`, `@pmndrs/viverse`,
`@pmndrs/timeline`. Nothing humanoid may appear in `body` (no bone names, no human ranges, no gait).

## Core (`@prohuman/body`)

### Skeleton
A rig description, parents before children:
```ts
interface BoneDef { name: string; parent: number /* -1 for the root */; offset: Vector3 /* rest offset in the parent frame */;
  mass: number /* kg */; com: Vector3 /* centre of mass in the bone frame */ }
interface Point { bone: number; at: Vector3 /* bone-local point, e.g. a heel */ }
```
Rest local rotations are identity (VRM-normalized convention: +Y up, facing +Z, left +X).

### State (generalized coordinates)
Root position + rotation (6 DOF) and one local rotation per bone (3 DOF, rotation-vector increments in
the parent frame). Velocities: root linear/angular and per-bone local angular velocity. World positions
and rotations of bones, the centre of mass and its velocity are derived after each solve.

### Proposals (what behaviours write each tick)
```ts
type Tier = 'main' | 'fallback'
interface Target {           // soft goal
  kind: 'position' | 'orientation' | 'aim' | 'local'
  point: Point               // for 'local': the bone (its local rotation)
  value: Vector3 | Quaternion
  axis?: Vector3             // 'aim': bone-local axis to point at `value`
  weight: number             // 0..1
  stiffness?: number         // natural frequency (Hz) of the pull; default from the bone's class
  tier?: Tier                // default 'main'
}
interface Contact { point: Point; position: Vector3; rotation?: Quaternion; priority: number }  // hard
interface Limit { bone: number; swing: [number, number][] /* per axis */; twist: [number, number]; axis: 0 | 1 | 2 }
interface Cap { bone: number; acceleration: number /* rad/s² */ }
interface Load { bone: number; mass: number; at: Vector3 }   // e.g. a carried box
```
The board is cleared every sub-step; behaviours call `ctx.propose.target(…)`, `.contact(…)`, `.limit(…)`,
`.cap(…)`, `.load(…)`.

### Merge rules (order-independent)
| output | rule |
|---|---|
| main targets | forces add (each weighted) |
| fallback targets | weight scaled by the main weight left on the same bone: `max(0, 1 − Σ main weights)` |
| contacts | exclusive per point: highest priority wins; ties → error (fail visibly) |
| limits | intersect (tightest) |
| caps | max |
| loads | add |

Each proposal may carry an `owner` string so behaviours can read next tick what they were granted
(`ctx.granted(owner)`: which contacts won).

### Solver (per sub-step, fixed dt)
1. Predict: damp velocities, integrate to `q̃`.
2. Soft targets: one weighted damped-least-squares step (analytic Jacobians: rotational DOF column
   `ω × (p − joint)`, orientation/aim rows, 'local' targets as diagonal terms; inertia as mass-weighted
   regularisation) gives the displacement each DOF wants. Each DOF follows that displacement on a
   critically damped spring at the target stiffness; the resulting acceleration is clamped per joint
   by the merged cap.
3. Hard projection: a few mass-weighted Gauss–Newton iterations on the winning contacts (position,
   and rotation when given), clamping every joint into its merged limits (swing–twist) after each.
4. Velocities from the actual change (`(q_new − q_old) / dt`), then derived world quantities.

No gravity in the solver: support and balance are behaviour-level. Performance is secondary in this
phase; correctness and clarity first. Keep it dense-matrix simple.

### Body
```ts
class Body<W = unknown> {
  constructor(skeleton: Skeleton, behaviour: ReusableTimeline<Ctx<W>>, options?: { world?: W })
  readonly state: Readonly<BodyState>
  update(dt: number): void          // sub-steps at 1/60 s: clear board → runner.step(ctx, clock) → merge → solve
}
interface Ctx<W> { body: Readonly<BodyState> /* last solved */; world: W; dt: number; time: number;
  propose: Board; granted(owner: string): Granted }
```
One `TimelineClock` per body (`frame` incremented once per sub-step). Errors propagate out of `update`.

## Humanoid (`@prohuman/humanoid`)

- **Rig adapter:** skeleton from a viverse `CharacterModel` (reuse the measuring in `core/src/rig.ts`,
  `proportions.ts`, `pose/bones.ts`; masses from Dempster fractions in `pose/mass.ts`), landmarks
  (nose, eyes, ears, heels, toes) as `Point`s, and writing the solved state back to the model exactly as
  the old `Rig.write` does (same VRM/glTF conventions, landmark nodes).
- **`Humanoid` convenience:** `new Humanoid(model, behaviour, { world })` = rig + `Body`, exposing the
  metrics surface: `model`, `proportions`, `feet` (position, yaw, phase), `yaw`, `velocity`, `seated`,
  `mounted`. Behaviours report feet phase / seated / mounted through a small shared status the
  adapter reads; no metric may need old-core internals.
- **`humanoid()` bundle** (a timeline, runs for the body's lifetime): human ranges of motion (data from
  `pose/limits.ts`), per-joint acceleration caps (table in `pose/dynamics.ts`), comfort (weak 'local'
  targets toward a relaxed standing pose, tier fallback), stand/balance (tier fallback: keeps planted
  feet as contacts, pelvis over the support, a recovery step when the extrapolated centre of mass (Hof)
  leaves the support).
- **Procedures** (reusable sub-timelines): `step(side, to, opts)`, `shiftWeight`, `swing` arcs with
  clearance, `ballistic`, `land`, `reach(hand, target)`, `grasp`/`release`, `lookAt`.
- **Behaviours** (compose procedures; end by an `until` condition or cancellation): stand, walk/run,
  look, reach/carry, crouch/duck, stairs, step-over, jump, climb, vault, ladder, sit, push recoil,
  strike/throw/aim/sword/kick, tracking (VR head/hands), ride (bicycle, skateboard, snowboard, car, horse).
- **World:** the app passes a world object (boxes, ground, ladders, seats, mounts as plain data);
  affordance queries live in `humanoid/src/world`.

### Composition rules
- Whatever must stay in sync is one behaviour built from procedures; independent things are separate
  behaviours run in `parallel`.
- Behaviours never write bones or transforms; they only propose. Do not use timeline's
  `transition`/`spring`/`lookAt` on body parts.
- No Promises inside body behaviours; use conditions and `timePassed` (simulation time).
- Graceful stop = an `until` condition the behaviour checks at good moments; hard stop = cancellation,
  covered by the fallbacks.

## Examples (`apps/examples/src/next`)

Each scenario: `{ id, title, duration, actors, world(), props(t), script(actors): timeline }` where the
script composes behaviours (and app-level direction) as one timeline per actor. A headless harness steps
them at 60 Hz and feeds frames to the **existing metrics** (`apps/examples/test/*`) through the adapter.
Effector targets a scenario sets are exposed for the target-error metrics.

Success per example: it runs the full duration, reads naturally as composed behaviours, and its metrics
stay within the old limits (balance: XCoM > 10 cm outside support is a bug). Report any example that
needs a core change or doesn't compose nicely; those findings are the point of the exercise.

## Amendments (from the scenario catalogue)

1. **Centre of mass as a point.** `Point` may also be the literal `'com'` (the body's centre of mass,
   loads included), for targets and contacts. Ballistic flight is a CoM contact following the parabola
   (the jump metric checks the CoM's vertical acceleration is −g ±15% while limbs tuck and swing).
2. **Impulses.** `propose.impulse(point, velocityChange)` (merge: add) changes the body's velocity at a
   point (a hit, a shove), distributed mass-weighted over the DOFs; used by a `recoil` behaviour fed by
   world events. Nothing else may inject velocity.
3. **Support.** `Contact.support?: number` (0..1, default 0): how much of the body's weight the contact
   carries (feet on the floor 1, a hand on a ladder rung or edge 1, a seat 1, a boarding mount ramping
   0→1, a guiding hand 0). Stand/balance computes the support region from granted contacts with
   support > 0, not just feet. A behaviour that holds the CoM off the support on purpose (push against a
   force) proposes a main-tier CoM target the balance fallback yields to.
4. **Strict default caps.** `humanoid()` proposes the strict, calm per-joint caps; fast behaviours
   (strikes, throws) loosen theirs (max merge). Grips are position contacts plus soft orientation targets.
5. **Status for metrics and scripts.** Behaviours write a shared humanoid `status`: feet phase per foot
   (`planted | swing | lifted | carried` with exactly the old meanings), `seated` 0..1, `mounted`, and
   the intent the metrics read from the old `ScenarioInput`: effector targets with weights (head, hands,
   feet), `lookAt`, `seat`, `mount { position, quaternion, weight, lean }`, `handForce`. The harness
   builds a `ScenarioInput`-shaped record per frame from that status plus the world, so the existing
   metric files run unchanged.
6. **Many actors.** Bodies read each other only through a per-frame snapshot of last frame's solved
   states (taken before any body updates), so update order never changes results. Shared scenario state
   (a fight's bout) lives in the world and emits events.
7. **Locomotion from effectors.** A `follow(effector)` behaviour turns a far hand/hips/head target into
   walk goals, facing and steps ("nobody scripts the steps"): lean when it's close, step when it's a bit
   far, walk when it's far.
8. **Stance.** `humanoid({ stance })` takes the old stance options (width, stagger, crouch, blade,
   toeOut, guard); the harness keeps exposing `actors[i].stance` for the metric exemptions.
9. **Released foot targets** are adopted by stand/balance as planted contacts at once (zero slide).

## Conventions
- Follow the `better-code` skill: KISS, fail visibly, shallow nesting, precise short names, no casts or
  ts-ignore, no legacy shims.
- Node ≥ 22.18; package scripts mirror `packages/core` (tsdown build, vitest tests, `typecheck`).
- Don't commit; the orchestrator decides. Don't touch `packages/core` or the old scenarios.
