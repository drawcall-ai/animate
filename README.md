# prohuman

Sparse-input, humanlike full-body IK for three.js.

You give any subset of: **head (eyes) pose, hand (wrist) targets, chest/hips pose, foot targets, a gaze target, a
place to stand or sit**. Everything missing is inferred: where to stand, when and where to step, pelvis height and
sway, trunk lean/twist, clavicle shrug, elbow and knee directions, head and gaze. For example, if the hands move
forward and nothing else is given, the body walks after them.

The output is a posed [@pmndrs/viverse](https://github.com/pmndrs/viverse) character model: any model viverse loads
(VRM 0/1, or a glTF with VRM-named bones), or an OpenPose skeleton that is itself such a model. The examples draw
OpenPose skeletons and, in some scenes, viverse characters: viverse's mannequin (walk-tray) and a
[Drawcall Market](https://www.npmjs.com/package/@drawcall/market) humanoid (stroll, installed with
`npx @drawcall/market install generic-stylized-human-neutral`; Draco-compressed, so load it with `useDraco`).

```
packages/core        @prohuman/core      the solver (pure TS, depends only on three's math)
packages/openpose    @prohuman/openpose  an OpenPose BODY_25 skeleton as a character model + 2D OpenPose/ControlNet drawing
apps/examples        examples app (Vite): scenarios, stage, bench (node + browser), test (motion metrics)
scripts              headless Chromium tools: contact sheets, videos, the browser benchmark
docs/RESEARCH.md     biomechanics / IK research notes behind the parameters
.github/workflows    CI: typecheck, test, metrics, build, lint:pkg
```

## Quick start

```bash
pnpm install
pnpm dev             # http://localhost:5287
pnpm test            # package tests: behaviour, posed models vs viverse's own retargeting, BODY_25 output
pnpm metrics         # asserted motion metrics, incl. balance: extrapolated centre of mass (Hof) vs support
```

Node ≥ 22.18 (see `.nvmrc`; the build needs it). The headless tools use Playwright's Chromium and start the dev
server themselves unless one is already running:

```bash
node scripts/capture.mjs --examples fight --frames 6 --views front,side,three,top [--body mannequin]  # → captures/*.png
node scripts/video.mjs --example walk-tray [--stills 2,6.5]   # frame-exact video (needs ffmpeg) or stills
pnpm bench [-- --n 20,50,100 --seconds 15 --alloc-sites]      # node: µs per character per tick, ms per frame, allocation
pnpm bench:browser [--n 20,50,100 --seconds 15]                # the same in headless Chromium (apps/examples/bench.html)
```

The benchmark steps crowds of the example scenarios at 60 Hz without rendering; the scenario scripts run outside the
timed spans. `bench.html` ships with the examples build, to measure on real devices.

## Usage

```ts
import { loadCharacterModel } from '@pmndrs/viverse';
import { Humanoid } from '@prohuman/core';

const model = await loadCharacterModel(); // viverse's mannequin; or loadCharacterModel('avatar.vrm'), …
scene.add(model.scene);
const body = new Humanoid(model, { position: { x: 0, y: 0, z: 0 }, yaw: 0 });

function frame(dt: number) {
  body.update(dt, {
    leftHand: { position: trayLeft }, // wrists; an Object3D works too (read through matrixWorld)
    rightHand: { position: trayRight },
    // head: xrCamera                        the eye midpoint + head rotation
    // chest / hips: { position, quaternion }
    // leftHand: { position, quaternion }    the quaternion is the VRM hand bone's world rotation
    // leftFoot / rightFoot: { position }    kicks, stepping on things
    // lookAt: point                         gaze (the body turns to face it)
    // goal: { position, quaternion? }       stand here; the quaternion holds that facing, also while walking there
    // seat: { position, quaternion? }       sit here (walks up, turns, sits; remove it to stand up)
    // floorObstacles: [box3]                places to stand clear of; low boxes are stepped over, or jumped when too wide to step (no path planning around tall ones)
    // bodyObstacles: [sphere | box3]        volumes the trunk/head give way to (a carried box; a low ceiling is ducked under)
    // ground: [box3]                       tops to stand on; a goal on one too high to step onto (0.6–1.35 × the body height) is climbed onto
  });
}
```

`update` poses the model's bones exactly as viverse retargets a VRM-normalized animation clip, and places
`model.scene` where the body stands (its world transform: add it to the scene itself, not to a moved parent); a VRM
is also updated (`vrm.update(dt)`: spring bones, look-at). The body's proportions are measured from the model's rest
pose, so hands and feet land on the mesh; as in viverse's retargeting, a glTF's bind pose counts as its rest and
should be a T-pose facing +Z. Every joint becomes a node of the model named after it: the VRM-named bones (a VRM
gets a node at each) and the landmarks the Humanoid adds — `nose`, `headTop`, `leftEye`, `leftEar`, `leftHeel`,
`leftBigToe`, `leftSmallToe` and the right ones — so positions are read from the model
(`model.scene.getObjectByName('leftHand').getWorldPosition(v)`), and every OpenPose keypoint is there. One Humanoid
per model.

Every target takes an optional `weight` (0..1) to blend between the inferred pose and the target, which is how
punches, grabs and releases are faded in and out. `body.push(velocity, 'head' | 'chest')` applies a hit or shove (a
velocity change in m/s): the head or trunk recoils and settles, and a strong push makes the body stagger.
`body.feet` tells where each foot stands (or is about to land) and whether it is planted; `body.seated` how far the
body has sat down on its `seat` (0 standing … 1 seated); `body.velocity`, `body.yaw` (its facing) and
`body.proportions` complete the picture (the skeleton plus derived measures such as `legLength`, `armLength`,
`eyeHeight`, `headCenter`, `heelBack`, `toeFront` and `scale` = height / 1.75).

Options: `stance` (`width`, `stagger`, `crouch`, `blade`, `toeOut`, `guard`) configures e.g. a bladed fighting stance
with a guard; `style: { hips, armSwing }` scales the walk's pelvic motion and arm swing (1 = natural, 0 = stiff, 1.5 =
pronounced); `maxSpeed` and `accel` (a runner might use `maxSpeed: 3.6, accel: 2.4`).

The gait blends walking into **running** by speed (around 2–2.5 m/s). Running brings shorter ground contacts, a
flight phase on a locked step clock, high heel recovery, bent pumping arms, a forward lean, and the body
compressing through each stance. Walks start foot-first: the first step fires at once and the body falls into it,
instead of the hips gliding ahead.

### OpenPose

`@prohuman/openpose` draws a body as an OpenPose BODY_25 skeleton — itself a viverse character model, so it is driven
like any other:

```ts
import { createOpenPoseModel, projectBody25, drawOpenPose2D, toBody25 } from '@prohuman/openpose';

const model = createOpenPoseModel({ height: 1.75 }); // bare VRM-named bones in the default proportions + the skeleton
scene.add(model.scene);
const body = new Humanoid(model);
// each frame: body.update(dt, input); the sticks follow the keypoints as the scene renders
drawOpenPose2D(ctx, projectBody25(model, camera, width, height)); // a ControlNet-style pose image
toBody25(model); // the 25 keypoints (world [x, y, z]) in OpenPose order
```

`model.scene.add(new OpenPoseSkeleton(model))` draws the skeleton over any other driven model, and
`createSkeletonModel(height)` (`@prohuman/core`) is the bare model underneath, for a body with no mesh at all.

## Packaging

`@prohuman/core` and `@prohuman/openpose` are ESM-only, side-effect free, and take `three >= 0.160` and
`@pmndrs/viverse >= 0.2.29` as peer dependencies; they import only types from viverse, so at runtime they need three
alone.

Inside the monorepo nothing needs building: every export carries a `@prohuman/source` condition pointing at the
TypeScript source, which `tsconfig.base.json` (`customConditions`) and the examples' `vite.config.ts` (also used by
vitest) resolve. Published consumers never set that condition and get `dist`.

```bash
pnpm typecheck      # all workspaces, against the sources
pnpm test           # package tests
pnpm metrics        # examples motion metrics
pnpm build          # tsdown → packages/*/dist (.js, .d.ts, sourcemaps); needs Node >= 22.18 (see .nvmrc)
pnpm lint:pkg       # publint --strict + attw --pack (esm-only profile), after build
```

Publish with `pnpm publish` (not `npm publish`), so `workspace:^` becomes a real version range. CI
(`.github/workflows/ci.yml`) runs all of the above.

## How it works

Each fixed step (60 Hz, sub-stepped automatically):

1. **Planner.** A 10-parameter posture model (support position, facing, pelvis drop and shift, hip flexion, spinal
   flexion, lateral bend, twist) is optimised with a small bounded Levenberg–Marquardt over residuals:
   - reachability of each hand target;
   - head, chest and hips targets;
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

**Obstacles and furniture.** A low `floorObstacles` box (its top below ~20% of the body height) is stepped over. The swing arc samples the heights along
the foot's path and rises over them, lifting first and then carrying the foot across. No foot ever lands on an
obstacle: steps stretch past it or stop short. The walk slows as an obstacle comes close, and the body waits for a
slow step instead of over-reaching the stance leg. `bodyObstacles` spheres (a carried box) make the trunk, head and knees give
way; the held object never has to move out of their path. A `bodyObstacles` box is cleared vertically: under a low
ceiling the body ducks just before it, walks through stooped (trunk forward, knees a little bent, head up looking
ahead), and straightens up once past it. `seat` sits the body down: it walks up, turns its back to
the seat, leans over its feet as the hips go back and down, and rests its hands on its thighs. Removing the seat makes
it lean forward and push up before walking on.

A low box too wide to step across (a ditch: from ~0.55 to 0.85 × the body height, ankle to ankle) is jumped with
both feet. The walk stops at its near edge with the feet together; the body sinks with the arms swung back, drives up
and forward with the arms leading, and flies a ballistic arc: the root carries the posed centre of mass along the
parabola the takeoff started, while the knees tuck and the legs reach forward. It lands on both heels, sinks to take
the speed and walks on. The root gains a level (`y`) for this: the height the body is carried at.

`ground` boxes are floor to stand on: the feet land on the top under them, and the root is carried at the level the
planted feet stand on. A goal on one too high to step onto, about the body's height, is climbed onto. The walk stops
facing its wall about an arm's length out; a small countermovement hop, the hands reaching up in front of the face,
catches the top edge. The body hangs with the feet on the face and the hips pushed out, pulls up as the feet walk up
the wall until the chest is at the edge, rolls the hands over onto the top and presses up. One foot comes up beside
the hands, its knee turned out, then the other, and the body stands up from the crouch and walks on. The key poses
(pelvis, trunk lean, hands, feet) are warped to the edge and the body's measures and joined by quintic curves; the
hands on the edge are holds the arms reach for (no path planning, no mantle onto lower boxes yet).

A tracked head, chest or hips path without its own gait oscillation (a scripted path) gets the walk's bob and sway
added on top, so it doesn't glide on rails. Real trackers already bob and are left untouched.

**Weight and tempo.** The upper body is a slightly underdamped pendulum on the pelvis. It lags when the body
accelerates (a small lurch back when setting off, forward when stopping) and absorbs impacts. Every posture degree
of freedom has a human speed limit, and body turning, squatting and gaze are paced like a person's. Explicit targets
can still be fast, so strikes stay explosive against a calm baseline.

Far-away hand targets aren't reached for directly. The arms keep swinging while the body walks, and the reach
blends in as the target comes within range.
