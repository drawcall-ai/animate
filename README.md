# prohuman

Sparse-input, humanlike full-body IK for three.js.

You give any subset of: **hand (wrist) targets, head pose, torso/pelvis pose, foot targets, a gaze target**.
Everything missing is inferred: where to stand, when and where to step, pelvis height and sway, trunk lean/twist,
clavicle shrug, elbow and knee directions, head and gaze. For example, if the hands move forward and nothing else is
given, the body walks after them.

The output is a pose (joint positions, including all OpenPose BODY_25 keypoints), rendered here as an OpenPose skeleton.

```
packages/core       @prohuman/core      the solver (pure TS, depends only on three's math)
packages/openpose   @prohuman/openpose  BODY_25 skeleton renderer for three.js + 2D OpenPose/ControlNet drawing
apps/examples       examples app (Vite) + motion metrics
scripts/capture.mjs headless contact-sheet renderer used for visual review
docs/RESEARCH.md    biomechanics / IK research notes behind the parameters
```

## Quick start

```bash
pnpm install
pnpm dev                    # http://localhost:5287
pnpm test                   # core sanity tests
pnpm --filter examples metrics   # incl. a balance check: extrapolated centre of mass (Hof) vs base of support
node scripts/capture.mjs --examples fight --frames 6 --views front,side,three,top
```

## Usage

```ts
import { Humanoid } from '@prohuman/core';
import { OpenPoseSkeleton } from '@prohuman/openpose';

const body = new Humanoid({ height: 1.75, position: { x: 0, y: 0, z: 0 }, yaw: 0 });
const skeleton = new OpenPoseSkeleton();
scene.add(skeleton);

function frame(dt: number) {
  body.update(
    {
      leftHand: { position: trayLeft },   // wrist targets
      rightHand: { position: trayRight },
      // head:   { position, rotation },    optional
      // pelvis: { position, rotation },    optional
      // torso:  { position, rotation },    optional (chest)
      // leftFoot / rightFoot: { position }  kicks, stepping on things
      // lookAt: point                      gaze (the body turns to face it)
      // obstacles: [{ minX, maxX, minZ, maxZ, height? }]  floor areas to stand clear of; low ones are stepped over
      // seat: { position, rotation? }      sit here (walks up, turns, sits; remove it to stand up)
      // avoid: [{ center, radius }]        volumes the trunk/head give way to (a carried box)
    },
    dt,
  );
  skeleton.update(body.pose);            // body.pose.leftElbow, .nose, … (Vector3)
}
```

Every effector takes an optional `weight` (0..1) to blend between the inferred pose and the target, which is how
punches, grabs and releases are faded in and out. `root: { position, rotation? }` means "stand here, facing this
way", and `body.impulse(direction, strength, 'head' | 'body')` applies a hit or shove: the head or trunk recoils and
settles, and a strong push makes the body stagger. `toBody25(body.pose)` returns the 25 keypoints in OpenPose order.
`projectBody25` plus `drawOpenPose2D` produce a ControlNet-style 2D pose image from any camera.

Options: `stance` (`width`, `stagger`, `crouch`, `turn`, `toeOut`, `guard`) configures e.g. a bladed fighting stance
with a guard; `style: { hips, armSwing }` scales the walk's pelvic motion and arm swing (1 = natural, 0 = stiff, 1.5 =
pronounced); `maxSpeed` and `accel` (a runner might use `maxSpeed: 3.6, accel: 2.4`); `faceTravel`.

The gait blends walking into **running** by speed (around 2–2.5 m/s). Running brings shorter ground contacts, a
flight phase on a locked step clock, high heel recovery, bent pumping arms, a forward lean, and the body
compressing through each stance. Walks start foot-first: the first step fires at once and the body falls into it,
instead of the hips gliding ahead.

## How it works

Each fixed step (60 Hz, sub-stepped automatically):

1. **Planner.** A 10-parameter posture model (support position, facing, pelvis drop and shift, hip flexion, spinal
   flexion, lateral bend, twist) is optimised with a small bounded Levenberg–Marquardt over residuals:
   - reachability of each hand target;
   - head, torso and pelvis targets;
   - effort (humans prefer upright, untwisted postures);
   - balance (centre of mass over the feet);
   - leg reach;
   - obstacle keep-out;
   - facing the gaze target.

   In this mode the support position is free, and leaning is penalised more than stepping, so the result answers
   *"where would a person stand to do this?"*
2. **Locomotion.** A root point follows the planner's answer with acceleration limits and target-velocity
   feed-forward. Steps are event-driven:
   - **placement:** Raibert-style (landing point predicted from velocity);
   - **timing:** cadence from the empirical walk ratio (step length / cadence ≈ 0.0056 m·min, a light brisk walk), about 60/40
     stance/swing;
   - **foot motion:** heel strike with toe-up, heel rocker, heel-off in terminal stance, and a toe-clearance bump;
   - **alternation and repair:** feet alternate, and adjustment steps fire when standing.
3. **Posture.** The same optimiser runs again with the support fixed at the actual root, so it now solves *"how do
   I hold my body here?"*. This yields squat vs stoop, the pelvis moving back when bending, and lean into reaches.
   The result is smoothed with critically damped springs (the trunk follows, the hands lead).
4. **Gait overlays:**
   - inverted-pendulum pelvis bob, lowest in double support;
   - lateral sway toward the stance foot;
   - pelvic rotation and obliquity;
   - thorax counter-rotation;
   - a slight forward walking lean, plus the inertial lag described below.
5. **Limbs.** Legs use analytic two-bone IK: knees track over the toes, and the pelvis is lowered when a leg can't
   reach. Arms get a clavicle shrug and protraction, then two-bone IK with an elbow swivel heuristic (down and back by
   default, outward when raised or crossing the body). A free arm hangs with a pendulum swing in counter-phase to
   the legs, or holds a guard.
6. **Head.** Gaze goes to the explicit target, else the active hand targets, else the path ahead. The neck takes
   about 40% of the rotation and the head the rest, within range-of-motion limits.

**Obstacles and furniture.** An obstacle with a `height` is stepped over. The swing arc samples the heights along
the foot's path and rises over them, lifting first and then carrying the foot across. No foot ever lands on an
obstacle: steps stretch past it or stop short. The walk slows as an obstacle comes close, and the body waits for a
slow step instead of over-reaching the stance leg. `avoid` spheres (a carried box) make the trunk, head and knees give
way; the held object never has to move out of their path. `seat` sits the body down: it walks up, turns its back to
the seat, leans over its feet as the hips go back and down, and rests its hands on its thighs. Removing the seat makes
it lean forward and push up before walking on.

A tracked head, torso or pelvis path without its own gait oscillation (a scripted path) gets the walk's bob and sway
added on top, so it doesn't glide on rails. Real trackers already bob and are left untouched.

**Weight and tempo.** The upper body is a slightly underdamped pendulum on the pelvis. It lags when the body
accelerates (a small lurch back when setting off, forward when stopping) and absorbs impacts. Every posture degree
of freedom has a human speed limit, and body turning, squatting and gaze are paced like a person's. Explicit targets
can still be fast, so strikes stay explosive against a calm baseline.

Far-away hand targets aren't reached for directly. The arms keep swinging while the body walks, and the reach
blends in as the target comes within range.
