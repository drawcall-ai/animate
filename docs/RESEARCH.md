# Procedural Human Motion from Sparse Inputs — Research Notes

Scope: a TypeScript + three.js library that turns any subset of {head, left hand, right hand, torso/pelvis} targets into a
plausible full-body pose and motion **without runtime ML**, using analytic IK, heuristics, and small
optimizations that run in real time.

Conventions used below: Y-up, right-handed (three.js), metres, degrees unless noted. `H` = standing body height.
GC = gait cycle (0 % = heel strike of the reference foot, 100 % = its next heel strike).

Confidence markers: **[src]** = value read from source code or a cited paper. **[norm]** = textbook normative value
(Perry, Winter, Inman, Kirtley). **[heur]** = a heuristic proposed here to tune by eye, not a measured value.

---

## 0. TL;DR

- Build it in layers: **input filtering → root/facing estimate → footstep planner + gait phase → pelvis → spine →
  shoulders/arms → legs/feet → head/gaze → balance and limit correction**. Every layer is analytic. At most one
  small damped-least-squares "comfort" pass at the end.
- Copy Final IK VRIK's structure. It is the proven sparse-tracker solver (head + 2 hands → full body). Its defaults
  are listed verbatim in §1.1.
- Use analytic two-bone IK everywhere and spend the effort on **pole/swivel selection** (§2). That is where most of
  the "robotic" look comes from.
- Drive locomotion with a **phase generator whose parameters depend on speed** (cadence from the walk ratio, stance
  about 60 %, pelvis bob about 4–5 cm twice per stride, and so on, §3), not with fixed curves.
- Humans move eyes → head → trunk → feet, and gaze → hand. Delay the body behind the attention target (§4, §5).

---

## 1. Full-body IK from sparse trackers

### 1.1 Final IK — VRIK (RootMotion). The reference design

Source: the VRIK solver files (`IKSolverVR*.cs`), read from a public mirror of Final IK's VRIK code
(https://github.com/xyonico/CustomAvatarsPlugin/tree/master/CustomAvatar/VRIK). Docs:
http://www.root-motion.com/finalikdox/html/page16.html. Field descriptions: https://wiki.resonite.com/Component:VRIK

**Default parameters [src]**

| Group | Field | Default | Meaning |
|---|---|---|---|
| Spine | `minHeadHeight` | 0.8 m | Head never goes below root + 0.8 m |
| | `bodyPosStiffness` | 0.55 | Fraction of the head translation that the pelvis follows |
| | `bodyRotStiffness` | 0.1 | Fraction of the head rotation applied to the pelvis |
| | `neckStiffness` | 0.2 | How much the chest turns with the head |
| | `rotateChestByHands` | 1.0 | Chest yaw/roll pulled toward the hand positions |
| | `chestClampWeight` | 0.5 | Clamps chest rotation |
| | `headClampWeight` | 0.6 | Clamps head vs chest (0.5 ≈ 90° allowed) |
| | `moveBodyBackWhenCrouching` | 0.5 | Moves the pelvis back when the head goes down |
| | `maintainPelvisPosition` | 0.2 | Keeps the animated pelvis position |
| | `maxRootAngle` | 25° | Root yaw follows the face direction once the difference exceeds 25° |
| Arm | `shoulderRotationMode` | YawPitch | Other option: FromTo |
| | `shoulderRotationWeight` | 1 | |
| | `bendGoalWeight` | 0 | Elbow hint target weight |
| | `swivelOffset` | 0° | Manual elbow twist around the shoulder→hand axis |
| | `armLengthMlp` | 1 | |
| Locomotion | `footDistance` | 0.3 | Lateral offset of each foot target from the COM (character space) |
| | `stepThreshold` | 0.4 m | Distance before a foot re-plants |
| | `angleThreshold` | 60° | Yaw difference before a foot re-plants |
| | `comAngleMlp` | 1 | Balance-loss sensitivity |
| | `maxVelocity` | 0.4 m/s | Velocity used for prediction is clamped to this |
| | `velocityFactor` | 0.4 | COM look-ahead = clamp(v, 0.4) × 0.4 |
| | `maxLegStretch` | 1 | Forces a step when the thigh–footstep distance ≥ leg length × this |
| | `rootSpeed` | 20 | Root catch-up rate |
| | `stepSpeed` | 3 | Step progress per second. Each step randomizes it in [3, 4.5], so a step takes 0.22–0.33 s |
| | `stepHeight`, `heelHeight` | sine 0→0.03 m→0 | Foot lift curve over step progress (peak at 0.5) |
| | `relaxLegTwistMinAngle` | 20° | A planted foot turns toward the facing direction beyond this angle… |
| | `relaxLegTwistSpeed` | 400 °/s | …at this speed, scaled by (1 − supportWeight) |
| | `stepInterpolation` | InOutSine | Horizontal foot interpolation |

**Spine / pelvis inference from the head (IKSolverVRSpine.Solve) [src]**

1. `faceDirection = cross(anchorRot·right, up) + anchorRot·forward`, where `anchorRot = headRot · (headRot₀⁻¹ · rootRot₀)`.
   Adding "forward" to "right × up" keeps the direction stable when the head pitches.
2. Root yaw: if the angle between the face direction and the root exceeds `maxRootAngle` (25°), rotate the root by the excess.
3. **TranslatePelvis**: rotate the pelvis by `slerp(I, clamp(pelvisDeltaRot), bodyRotStiffness)`. Then add the back offset
   `backOffset = −|Δy_head| · moveBodyBackWhenCrouching · headHeight`, applied along root forward. Move the pelvis by
   `Δhead · bodyPosStiffness`. Finally **LimitPelvisPosition**: 2 iterations that clamp each thigh to within leg length of
   its planted foot.
4. A FABRIK pass from pelvis to head squashes or stretches the spine chain.
5. **Bend** the spine toward the chest target rotation. The rotation is distributed along the bones with weights
   `(i+1)/n`, so the chest gets the full amount. The chest target is `headRot·chestRelToHead`, adjusted by the hands:

   ```ts
   // AdjustChestByHands. pL, pR = hand positions relative to the head, in anchor space, divided by sizeMlp.
   // sizeMlp = |pelvis - head| / 0.7
   cx  = pL.x*|pL.x| + pL.z*|pL.z| + pR.x*|pR.x| - pR.z*|pR.z|;  cx *= 5 * rotateChestByHands;
   yaw = atan2(cx, 1);                        // about up
   tx  = (pL.y - pR.y) * 0.5 * rotateChestByHands;
   roll = atan2(tx, 1);                       // about back
   ```
   In words: one hand far forward or sideways twists the chest toward it, and one hand raised rolls the chest.
6. `InverseTranslateToHead`: move the pelvis by the remaining head error × (1 − pelvisPositionWeight). Then FABRIK again,
   then bend the neck and head uniformly to the head rotation, clamped by `headClampWeight`.

**Locomotion (IKSolverVRLocomotion.Solve) [src]**

```ts
com = (pelvis*1 + head*1 + handL*0.2 + handR*0.2) / 2.4 + rootRot*offset;
comVel = clampMag((com - lastCom)/dt, maxVelocity) * velocityFactor;
comV   = com + comVel;                              // predicted COM
cop    = (foot0 + foot1)/2;                          // centre of pressure
comAngle = angle(comV - cop, up) * comAngleMlp;      // lean angle
canStep = no foot is stepping with progress < 0.8;
for each foot not stepping:
  stepTo = ground(comV) + rootRot * (±footDistance, 0, 0);
  if |thigh - footPos| >= legLen*maxLegStretch: stepTo = ground(pelvis)+offset; lengthStep = true
  skip if the swept line would hit the other foot (sphere r = 0.25) unless yaw diff > angleThreshold
  sT = lerp(stepThreshold, 0.1*stepThreshold, comAngle*0.015);   // leaning → step sooner
  if lengthStep: sT *= 0.5;  if left: sT *= 0.9                   // tie-break: left foot first
  if |foot - stepTo| > sT || yawDiff > angleThreshold: candidate (prefer the smaller distance)
start step: stepSpeed = rand(3, 4.5); progress 0→1;
  position = lerp(from, to, easeInOutSine(p)); height += sine(p)*0.03;
  while stepping: stepTo = lerp(stepTo, newTarget, dt*10)          // retargets mid-step
```

**Arms (IKSolverVRArm) [src]**

- *Shoulder, YawPitch mode.* Yaw is the direction to the hand in a chest-relative working space, attenuated by
  `1 − |dir·up|`. It is damped into [0°, 60°] forward (left: [−60°, 0°]) with a quintic ease. Pitch is measured from a
  point one clavicle length medial and damped into ±45°. After the two-bone solve, the clavicle and upper arm get
  extra rotation `p = clamp(2·pitch, 0, 180)` about the shoulder axis. This produces the overhead shrug.
- *Elbow bend normal* (`GetBendNormal`), in chest space:
  1. `b = FromTo(down, dir + forward) · back`. The default elbow points back and down.
  2. Rotate `b` by the swing from the current upper-arm direction to the hand direction.
  3. `b = slerp(b, armDir, 0.5)`.
  4. Hand orientation: `vHand = −(0.15·wristToPalm + 0.85·palmToThumb)` (rotated). Blend `b` toward `vHand` with weight
     `(dot(b, vHand) + 1)/2 · 0.75`. The thumb direction therefore steers the elbow, which is a big realism win when
     hand rotation is tracked.
  5. Optional bend goal and `swivelOffset`. The final normal is `cross(b, dir)`.
- After the solve, the forearm twist is re-derived from the upper arm, and the hand takes the target rotation.

**Legs.** The bend normal is taken from the current (animated) knee plane, rotated by the change in foot/leg
orientation. Knees therefore follow the foot direction.

### 1.2 FABRIK and full-body FABRIK

Aristidou & Lasenby 2011, http://www.andreasaristidou.com/FABRIK.html. Full-body version with constraints: Aristidou,
Chrysanthou, Lasenby, "Extending FABRIK with model constraints" (CAVW 2016).

```ts
function fabrik(p: V3[], len: number[], root: V3, target: V3, iters = 10, tol = 1e-3) {
  if (dist(root, target) > sum(len)) {            // unreachable: straighten toward the target
    for (i=0;i<n-1;i++) p[i+1] = lerp(p[i], target, len[i]/dist(p[i],target)); return;
  }
  for (k=0; k<iters && dist(p[n-1],target)>tol; k++) {
    p[n-1] = target;                                  // backward pass
    for (i=n-2;i>=0;i--) p[i] = p[i+1] + normalize(p[i]-p[i+1])*len[i];
    p[0] = root;                                      // forward pass
    for (i=0;i<n-1;i++) p[i+1] = p[i] + normalize(p[i+1]-p[i])*len[i];
    // constraints: after placing p[i+1], project the bone direction into the cone/ellipse around the parent bone
  }
}
```

- Multi-end-effector: solve each sub-chain backward to the shared sub-base, average the sub-base positions (centroid),
  then do the forward pass from the root. This is how a spine gets pulled by both hands and the head.
- Converges in about 3–15 iterations with no matrices, but gives only positions. Rotations must be reconstructed as
  swing (FromTo) plus a twist choice. Use it for the **spine**, which VRIK does too. Use analytic IK for limbs.

### 1.3 CCD

Iterate from the end joint to the root, rotating each joint so the effector points at the target. Cheap and easy to
constrain per joint, but it curls chains (the distal joints over-rotate) and looks unnatural for arms and spines unless
damped. three.js ships `CCDIKSolver` (`three/examples/jsm/animation/CCDIKSolver.js`). Useful only for tails, fingers,
and extra spine bones. Tip: cap each joint's per-iteration rotation (for example 5–10°) and weight the proximal joints.

### 1.4 Analytic two-bone IK with pole vector (use this for all limbs)

```ts
// a = upper length, b = lower length, S = root joint, T = target, P = pole (hint) point
d = clamp(|T-S|, |a-b|+ε, a+b-ε);        // soft-clamp near full extension to avoid knee/elbow snapping
n = normalize(T-S);
cosA = (a*a + d*d - b*b)/(2*a*d);        // angle at S between S→T and S→mid
h = a*sqrt(1-cosA*cosA);                 // swivel circle radius
C = S + n*(a*cosA);                      // swivel circle centre
u = normalize((P-S) - n*dot(P-S,n));     // pole direction projected onto the circle plane
Mid = C + u*h;
// Joint rotations: upper = FromTo(restUpperDir, Mid-S) followed by a twist fix; lower = FromTo(restLowerDir, T-Mid)
// (applied in the parent frame). Keep the twist continuous by reusing the previous frame's up vector.
cosKnee = (a*a + b*b - d*d)/(2*a*b);     // interior angle; flexion = 180° - acos(cosKnee)
```

**Soft extension** (prevents the "pop" at full reach, as used in many rigs): if `d > dSoft = (a+b)·0.97`,
`d' = dSoft + (a+b−dSoft)·(1 − exp(−(d−dSoft)/(a+b−dSoft)))`. Then either leave the small hand error or let the clavicle
or pelvis absorb it.

**Swivel parameterization** (Tolani, Goswami, Badler 2000, "Real-time inverse kinematics techniques for anthropomorphic
limbs", https://repository.upenn.edu/hms/41/). The elbow lies on the circle above. Define the swivel angle φ with a
reference `u0 = normalize(down − n(down·n))` (the lowest point of the circle is φ = 0) and `v0 = n × u0`:
`Mid(φ) = C + h(cos φ·u0 + sin φ·v0)`. This one scalar is what the natural-pose heuristics in §2 predict.

### 1.5 Engine full-body IK (for comparison)

- **Unity Animation Rigging**: `TwoBoneIKConstraint` (analytic with hint), `ChainIKConstraint` (FABRIK),
  `MultiAimConstraint` (distributed aim for spine and neck with per-bone weights), `DampedTransform`. Humanoid IK
  (`OnAnimatorIK`) has an analytic limb solve plus body-position adjustment.
  https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/index.html
- **Unreal IK Rig / Full Body IK**: `PBIK` ("Position Based IK") is an XPBD-style solver. Parameters: per-bone
  rotation stiffness, "pull chain alpha" (how much an effector drags the chain toward the root), root behaviour
  (pinned, free, or pre-pull), soft joint limits, and "mass multiplier". The older "Full Body IK" node was
  Jacobian-based. https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-solvers-in-unreal-engine
  Design lesson: *stiffness per bone plus a pre-pull of the root toward effectors* gives a natural distribution of
  effort (spine stiff, clavicle moderately stiff).

### 1.6 Optimization-based pose inference (energy minimisation / comfort)

Use this as an **optional refinement** (1–3 damped Gauss-Newton or LM iterations on about 30–40 DoF). It does not replace
the analytic layers.

```
E(q) = Σ_e w_e·|FK_e(q) − x_e*|²                         (effector targets; w: hands 1, head 1, feet 5)
     + Σ_j (q_j − q_j^comfort)ᵀ W_j (q_j − q_j^comfort)  (comfort / rest prior, W ∝ joint stiffness)
     + Σ_j barrier(q_j; limits)                           (smooth joint limits, e.g. softplus(k(q−qmax))²)
     + w_bal·|COM_xz(q) − proj_supportPolygon(COM_xz)|²   (balance)
     + w_sm·|q − q_prev|²                                 (temporal smoothness)
Δq = (JᵀWJ + λ²I + P)⁻¹ (JᵀW r − P(q − q_comfort))       λ ≈ 0.05–0.2 (damped least squares)
```

Comfort / neutral values [heur, based on the resting "neutral" posture in ergonomics]: shoulder abduction about 10–20°;
flexion about 10–20°; elbow flexion about 15° when hanging and 80–90° when holding something in front; forearm in mid
pronation; wrist extension about 10–15°; hip and knee flexion 0–5° standing; neck flexion about 10–15° (the head looks
slightly down). Stiffness ordering (high → low): pelvis position > lumbar > thoracic > neck > clavicle > shoulder >
elbow. Joint-limit reference (AAOS, typical active ROM): shoulder flexion 180 / extension 60 / abduction 180 / internal
rotation 70 / external rotation 90; elbow 0–145; pronation/supination 80/80; wrist flexion 80 / extension 70 / radial 20 /
ulnar 30; hip flexion 120 / extension 20–30 / abduction 45 / adduction 30 / internal rotation 35–40 / external rotation 45;
knee 0–135; ankle dorsiflexion 20 / plantarflexion 50; cervical flexion 45–50 / extension 60–75 / lateral 45 /
rotation 70–80; thoracolumbar rotation about 30–40 each side, lumbar flexion about 50–60 / extension 20–30.

---

## 2. Natural elbow and knee direction; clavicle

### 2.1 Soechting & Flanders sensorimotor model (arm posture from hand position)

Soechting & Flanders 1989 (J Neurophysiol 62:582–594 and 595–608). Linear form as used for animation IK by
Koga, Kondo, Kuffner, Latombe, "Planning Motions with Intentions", SIGGRAPH 1994
(https://www.ri.cmu.edu/pub_files/pub4/koga_yoshihito_1994_1/koga_yoshihito_1994_1.pdf, Eq. 2) **[src]**:

Shoulder frame: x = lateral (along the shoulder line), y = anterior (out of the chest), z = up.
Hand (wrist) in spherical coordinates:
`R = √(x²+y²+z²)` (cm), elevation `ψ = atan(z / √(x²+y²))`, azimuth `χ = atan(x / y)` (degrees).

```
θ (upper-arm elevation) = −4.0 + 1.10·R + 0.90·ψ
β (forearm elevation)   = 39.4 + 0.54·R − 1.06·ψ
η (upper-arm yaw)       = 13.2 + 0.86·χ + 0.11·ψ
α (forearm yaw)         = −10.0 + 1.08·χ − 0.35·ψ
```

Elevations are measured from the downward vertical (0 = hanging). Yaws are measured in the horizontal plane from
anterior. Units are cm and degrees. The model is fitted to targets within reach (roughly R ≤ arm length) near the front
of the body. It predicts the **elbow position**, which is exactly the swivel/pole choice. Koga et al. then correct the
hand error with an exact IK. If a joint limit is violated, they decrease the swivel (raise the elbow) until it is legal.

Implementation: compute the elbow E from (θ, η) and upper-arm length. Use `P = E` as the pole point for the analytic
solve, which fixes the residual error. Blend toward the §2.2 heuristic outside the fitted domain (behind the body, above
the head, far across).

### 2.2 Practical swivel heuristic (fallback and extension) [heur]

With φ as in §1.4 (φ = 0 means the elbow is straight down below the shoulder–wrist axis, positive means the elbow
swings outward/lateral):

```
φ = φ0                                   // 15–25° outward baseline (elbows are slightly abducted at rest)
  + k_up    * clamp(elevation_hand, 0, 90°) * 0.35   // hand high → elbow out/up (≈ +30° at head height)
  + k_cross * max(0, −lateral_hand)  (per metre, ~60°/m)  // hand across the midline → elbow up/out
  + k_back  * max(0, −anterior_hand) (~90°/m)           // hand behind the torso plane → elbow out/back
clamp φ to [−20°, 110°]
```

When the hand orientation is known, also blend (VRIK style) toward the thumb direction: the elbow tends to sit opposite
the thumb-side radial deviation. Use the elbow opposite the palm-to-thumb axis with weight ≤ 0.75 (§1.1).

Kim & Rosen-style criterion (humans pick a swivel that keeps the hand able to move toward the head/mouth). Among
feasible φ, choose the one that maximises manipulability along the hand→head direction. This works as a cheap 1-D
search (8–16 samples) in the optimization layer. Ref: Kim, Rosen et al., "Redundancy resolution of the human arm and an
upper limb exoskeleton", IEEE TBME 2012.

### 2.3 Knee pole

- Knee plane ≈ plane of hip, ankle, and the foot's forward direction. Use `pole = ankle + footForward·0.5 + pelvisForward·0.2`
  (lifted to knee height). Keep the knee over the 2nd–3rd toe.
- Natural toe-out (foot progression angle) is about 5–7° per foot in walking **[norm]**, so knees point slightly outward.
- Under deep squat, knees track outward with the feet (abduction/external rotation of about 10–20°) **[heur]**.

### 2.4 Clavicle / scapula when reaching

- **Scapulohumeral rhythm** [norm, Inman 1944]: after the first ~30° of arm elevation, glenohumeral : scapulothoracic
  ≈ 2 : 1. Full 180° elevation ≈ 120° glenohumeral + 60° scapular upward rotation.
- Clavicle elevation ≈ 4° per 10° of arm elevation up to about 90° of arm elevation, then little more. Total clavicle
  elevation is about 30–35°, with about 15–30° retraction at full elevation.
- Model: `clavElev = clamp(0.33·(armElev − 30°), 0, 35°)`; `clavProtract = clamp(0.4·reachForwardExcess, 0, 20°)`, where
  reachForwardExcess is the angle beyond 60° of forward flexion; retract with horizontal abduction. VRIK's equivalent:
  shoulder pitch damped to ±45°, then an extra rotation of `2·pitch` on the clavicle and upper arm.
- Reach beyond arm length is taken up in this order: clavicle protraction (≈ 5–10 cm) → trunk lean/rotation → step.

---

## 3. Procedural locomotion

### 3.1 Foot placement

**Raibert heuristic** (Raibert 1986, *Legged Robots That Balance*):
`x_foot = x_hip + v·T_stance/2 + k_v·(v − v_des)`, with k_v ≈ 0.03–0.1 s. Laterally, add the step-width offset.

**Capture point** (Pratt et al. 2006, "Capture point: a step toward humanoid push recovery"; linear inverted pendulum):
```
ω = √(g / z_com)          // z_com ≈ 0.55·H → ω ≈ 3.1 s⁻¹ for H = 1.75 m
ξ = x_com + v_com / ω     // instantaneous capture point (2-D, on the ground)
```
Step when ξ leaves the support polygon (a stability margin of about 2–5 cm). Place the foot at `ξ + offset`, where the
offset is the lateral half step width plus a forward component for continued walking:
`ξ_target = x_foot_next + b`, `b = L_step/(e^{ωT}−1)`. The VRIK trigger (§1.1) is a simplified version of this: COM
lean angle lowers the step threshold.

**Step triggering for idle/VR** (combine):
1. The capture point is outside the support polygon (with a margin).
2. The planted foot yaw differs from the body facing by > 45–60° (VRIK 60°), or the leg is twisted beyond 20° → rotate
   the foot in place or step.
3. The leg is stretched ≥ 95–100 % of its length.
4. Distance to the ideal stance position is > 0.2–0.4 m.
5. Alternate feet. Do not start a step until the other foot is ≥ 80 % done. Choose the foot whose step reduces the error
   most, or the unloaded foot (the one opposite the COM shift).

### 3.2 Gait timing vs speed

| Quantity | Value | Source |
|---|---|---|
| Preferred walking speed | 1.3–1.4 m/s (≈ 0.8·√(g·leg) … Froude 0.25) | [norm] |
| Cadence at preferred speed | 100–120 steps/min (stride time ≈ 1.0–1.1 s) | [norm] |
| Walk ratio (step length / cadence) | ≈ 0.0065 m/(steps/min), roughly speed-invariant; scale ∝ H | [src] Sekiya & Nagasaki; https://pubmed.ncbi.nlm.nih.gov/29494821/ |
| Step length at preferred speed | ≈ 0.41·H (men 0.415 H, women 0.413 H) | [norm] |
| Step width | 0.08–0.12 m (heel centre to heel centre) | [norm] |
| Walk–run transition | ≈ 2.0 m/s, Froude v²/(g·l) ≈ 0.5 | [norm] |
| Stance / swing | ≈ 60–62 % / 38–40 % at 1.4 m/s | [norm] Perry |
| Double support | 2 × ≈ 10–12 % ≈ 20–24 % of GC (→ 0 at the run transition) | [norm] |

Formulas (from the walk ratio `WR = L/c`, v = L·c/60):
```
c(v)  = √(60·v / WR)       // steps/min;  WR = 0.0065·(H/1.72)
L(v)  = WR · c(v)          // m per step
T_stride = 120 / c         // s
// check: v = 1.4 → c ≈ 114 steps/min, L ≈ 0.74 m, T_stride ≈ 1.05 s
stanceFrac(v) ≈ clamp(0.665 − 0.035·v, 0.55, 0.70)     // [heur] fit: 0.63 at 1.0 m/s, 0.615 at 1.4, 0.60 at 1.8
doubleSupport  = 2·stanceFrac − 1
```
The implementation (`packages/core/src/gait/timing.ts`) uses **WR = 0.0056·(H/`DEFAULT_HEIGHT`)**, the low end
of the adult range (≈ 0.0055–0.0075) rather than Sekiya's mean of 0.0065: shorter steps at a quicker cadence, a light
brisk walk (v = 1.4 → c ≈ 122 steps/min, L ≈ 0.69 m).

For slow speeds (< 0.6 m/s) the walk ratio breaks down (people shorten steps more than cadence). Clamp L ≥ 0.25 m and
fade into "step in place / shuffle" behaviour.

### 3.3 Gait-cycle events (% GC) [norm, Perry]

| Event | %GC |
|---|---|
| Initial contact (heel strike) | 0 |
| Loading response (to opposite toe-off) | 0–10/12 |
| Mid stance | 10–30 |
| Heel-off (heel rise) | ≈ 30–40 (start of terminal stance at ~31 %) |
| Opposite initial contact | 50 |
| Pre-swing | 50–62 |
| Toe-off | 60–62 |
| Initial swing / feet adjacent | 62–73 |
| Mid swing (tibia vertical, min toe clearance) | 73–87 |
| Terminal swing | 87–100 |

### 3.4 Sagittal joint profiles (1.4 m/s) [norm, Perry / Winter / Kirtley normative data]

| Joint | Keyframes (%GC → angle, + = flexion / dorsiflexion) |
|---|---|
| Hip | 0 → +30, 50 → −10 … −20 (peak extension ~50 %), 62 → 0, 85 → +35 (peak), 100 → +30 |
| Knee | 0 → 3–5, **12–15 → 15–20 (loading response)**, 40 → 3–5, 62 → 35–40, **70–73 → 60–65 (swing peak)**, 97 → 0–5 |
| Ankle | 0 → 0, 7 → −5 … −10 (foot flat), 45 → +10, **62 → −15 … −20 (toe-off)**, 75 → 0, 100 → 0 |
| Foot–floor angle | IC: toe up ≈ 15–25°. Toe-off: heel up ≈ 50–60° (foot pitched about the MTP joints) |

Implementation: store these as Catmull-Rom keys over phase, scale amplitudes with speed (≈ ∝ v/1.4 clamped to
[0.4, 1.3]), and use them as **pole/pitch priors**. Foot positions still come from IK so the feet never slide.

### 3.5 Swing foot trajectory

- Minimum toe clearance about **1–2 cm** (mean ≈ 1.3–1.4 cm) at mid swing, when the foot passes the stance foot
  (Winter 1992, https://pubmed.ncbi.nlm.nih.gov/1728048/; https://www.nature.com/articles/s41598-017-02189-y). MTC
  doubles with visible obstacles (2.2 cm).
- The toe has two height peaks: just after toe-off (≈ 10–15 cm, from heel lift and knee flexion) and late swing, with
  MTC between them. The heel rises highest in early swing (≈ 20–30 cm) [approx] and has a local minimum just before IC.
- Generate the swing in the **foot-roll frame**:
  ```ts
  s = swingPhase ∈ [0,1];  e = minJerk(s)                       // horizontal progress
  pos = lerp(liftOff, landing, e);
  pos.y += clearance * bump(s)       // bump = 4s(1−s), skewed early: use s' = s^0.8; clearance ≈ 0.05–0.08 m for the ankle
  pitch = lerpKeys(s, [ [0, −55°(toe-off heel-up)], [0.3, −20°], [0.6, 0°], [0.9, +15°], [1, +20°(heel strike)] ])
  ```
  Stance: heel pivot 0–7 % (foot rotates from +20° to 0° about the heel), flat 7–35 %, heel rise from ~35 % pivoting about
  the toe/MTP up to toe-off. The contact pivot moves heel → ankle → toe, so the ankle rises and translates without sliding.

### 3.6 Pelvis (and COM) motion [norm; https://pubmed.ncbi.nlm.nih.gov/15685471/, https://pubmed.ncbi.nlm.nih.gov/11239313/]

| Motion | Amplitude @ 1.4 m/s | Frequency, phase |
|---|---|---|
| Vertical bob | 4–5 cm peak-to-peak (≈ 2.7 cm at 0.7 m/s, ≈ 5–8 cm at 2 m/s) | 2× per stride. **Lowest at double support (≈ 0–5 %, 50–55 %), highest at mid stance (≈ 25–30 %, 75–80 %)** |
| Lateral sway | 4–5 cm p-p (≈ 7 cm slow, ≈ 4 cm fast) | 1× per stride, toward the stance leg, peak at mid stance |
| Pelvic rotation (yaw) | total 4–10° (mean ≈ 4–8°) | 1× per stride. The swing-side hip rotates forward, max at that foot's IC |
| Obliquity (list) | ±3–5° (total 6–11°) | Swing side drops. Max drop ≈ 10–15 % GC (just after opposite toe-off), level at mid stance |
| Tilt (pitch) | mean ≈ 10° anterior, excursion 2–4° | 2× per stride |
| Forward speed | ± ≈ 5–10 % velocity fluctuation | Slowest at mid stance (the peak of the bob, inverted pendulum) |

```ts
// φ = stride phase ∈ [0,1), right heel strike at 0
bob   = -A_v/2 * cos(4π(φ - 0.02));          // min at 0.02 and 0.52
sway  =  A_l/2 * sin(2π(φ - 0.02)) * (-1);   // toward the right during right stance (sign depends on axes)
yaw   =  A_rot/2 * cos(2πφ);                 // right hip forward at right IC
list  =  A_obl/2 * sin(2π(φ - 0.12)) * ...   // unloaded side drops
A_v(v) ≈ clamp(0.02 + 0.02*v, 0.02, 0.07);   A_l(v) ≈ clamp(0.08 - 0.025*v, 0.03, 0.08)
```

### 3.7 Trunk counter-rotation, arm swing, head

- The thorax rotates **opposite** the pelvis at normal and fast speeds. Relative phase goes from ≈ −20° at 1 km/h to
  ≈ −150° at 5.4 km/h. Thorax yaw amplitude ≈ ±3–5° (total 6–10°) [Bruijn et al. 2008,
  https://pubmed.ncbi.nlm.nih.gov/17669652/; https://www.nature.com/articles/s41598-018-37549-9]. Model: thorax yaw =
  −k·pelvisYaw with k rising from 0 (slow) to ≈ 1 (fast), phase-shifted.
- **Arm swing**: antiphase to the ipsilateral leg. The right arm is most forward at left heel strike. Shoulder
  flexion/extension range ≈ 25–40° at 1.4 m/s (about +20° forward, −15° back relative to hanging), growing with speed.
  Elbow mean flexion ≈ 20–30° with ≈ 10–20° oscillation (most flexed at forward swing). Mostly passive: add lag ≈ 5–10 %
  GC behind the pure antiphase. Below ≈ 0.8 m/s arms may swing at 2:1 frequency or barely at all.
  [https://www.sciencedirect.com/science/article/abs/pii/S016794571630077X, Hejrati et al. 2016]
  ```ts
  shoulderFlex_R = offset + A_arm(v)/2 * cos(2π(φ - 0.5 - lag));  A_arm(v) ≈ clamp(25*v, 5, 50) deg
  elbowFlex = 20 + 8*v + (A_arm/3) * max(0, cos(2π(φ - 0.5 - lag)))
  ```
  When a hand target exists, suppress swing on that arm and keep a small residual (≈ 10–20 %) in the shoulder only.
- Trunk forward lean ≈ 2–5° walking, more with speed or acceleration (lean ∝ acceleration: `atan(a/g)`).

### 3.8 Turning in place

- **Top-down sequence**: eyes → head → trunk → pelvis → leading foot → trailing foot. Each segment's onset is delayed.
  Larger turns delay all onsets. Head onset precedes the feet by ≈ 100–300 ms in brisk turns
  [https://pmc.ncbi.nlm.nih.gov/articles/PMC8074235; Hollands et al.].
- Step count (healthy): 90° ≈ 2–3 steps, 180° ≈ 3–5 steps, 360° ≈ 5–8 steps. Each step ≈ 0.4–0.6 s, and each foot rotates
  ≈ 30–60° per step. The inner foot pivots (spin turn) or the outer foot leads (step turn).
- Algorithm: when desired facing − current pelvis yaw > 20–25°, start a turn. The head takes up to 60–70° immediately
  (neck), the thorax lags 100–150 ms, and the pelvis lags another 50–100 ms. Plan steps so that each new foot yaw
  = pelvis yaw + (±toe-out), stepping first with the foot on the turn side (open step) when turning > 45°.
- While walking along a curve, the head anticipates the path by ≈ 200 ms / 20–25° (Grasso et al. 1998).

---

## 4. Reaching and manipulation

### 4.1 Minimum-jerk trajectories (Flash & Hogan 1985, J Neurosci 5:1688)

```ts
τ = t/T;  s = 10τ³ − 15τ⁴ + 6τ⁵;   x(t) = x0 + (x1−x0)·s
v_peak = 1.875·|x1−x0|/T  (at τ=0.5);  a_peak ≈ 5.77·D/T²
// retargeting mid-motion: re-plan a quintic with the current position/velocity/acceleration as boundary conditions
```
- Hand paths are **straight lines in Cartesian space** with a bell-shaped speed profile. Interpolate the hand target,
  not the joint angles.
- Duration (Fitts): `T = a + b·log2(2D/W)`, with a ≈ 0.1–0.2 s and b ≈ 0.1–0.15 s/bit. Natural reaches of 0.3–0.5 m take
  ≈ 0.5–0.9 s. Curved paths follow the two-thirds power law: `v = K·κ^(−1/3)`.
- Orientation: slerp with the same s(τ). Grasp aperture peaks at ≈ 60–70 % of the reach time.

### 4.2 Gaze leads hand

- The eyes start first, the head shortly after (≈ 0–50 ms), then the hand. The gaze reaches the target before the hand's
  peak velocity: around hand onset or peak acceleration (https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3045308/).
  In lab pointing the eye leads the hand by ≈ 50–150 ms. In natural tasks the eye leads the action by several hundred
  ms (≈ 0.5–1 s; Land & Hayhoe 2001, Johansson et al. 2001).
- The eyes leave the target for the next one about when the hand arrives or grasps (≈ 0–200 ms before contact).
- Implementation: attention target = the next hand goal. Start the head turn at `t_hand − 150 ms` (range 100–300 ms)
  with head duration ≈ 250–500 ms (min-jerk). Hold the gaze until the grasp completes, then shift to the next goal.

### 4.3 Lifting from the ground [https://link.springer.com/article/10.1186/1471-2474-10-15]

| Strategy | Knee flexion | Trunk flexion | Notes |
|---|---|---|---|
| Squat | ≈ 135° | < 30° | Heels may rise; the pelvis drops almost vertically; the hands go between the knees |
| Semi-squat | ≈ 90° | ≈ 45° | The most common natural choice |
| Stoop | < 45° | ≈ 90° | Lumbar flexion ≈ 55–60° is similar in both; the hips go far back |

Selection heuristic [heur]: target height < 0.25·H and object "heavy" or large → squat/semi-squat; light and small →
stoop or golfer's lift (one leg extends back). Blend by target height: `kneeFlex = lerp(10°, 120°, smoothstep(0.55H, 0.1H, y_target))`.
The pelvis height then follows from leg IK, and the trunk takes the rest. Stance widens to about hip width + 10 cm, with
one foot often forward by 10–20 cm.

### 4.4 Placing an object overhead [heur, from the anatomy above]

- Standing vertical reach ≈ 1.25–1.33·H (fingertip). For the wrist, subtract the hand length (0.108 H).
- Recruitment order as the target height increases: arm elevation up to about 150° (with scapular rotation) →
  clavicle elevation (≈ +30°) → lumbar/thoracic extension ≈ 5–15° (the trunk leans back slightly to put the shoulder
  under the target) → **heel raise** (up to ≈ 5–8 cm, ankle plantarflexion ≈ 20–30°) once the target is within about
  5 cm of the flat-foot reach limit. The head extends 10–30° to look up. The pelvis shifts forward slightly to keep the
  COM over the forefoot.

### 4.5 Balance

- Keep the ground projection of the COM inside the support polygon (the convex hull of the foot contacts). Stability
  margin ≈ 2–5 cm.
- COM from Winter/Dempster segment masses (fraction of body mass) [src, Winter Table 4.1,
  https://courses.grainger.illinois.edu/me481/sp2021/Anthro-Winter.pdf]: hand 0.006, forearm 0.016, upper arm 0.028,
  foot 0.0145, shank 0.0465, thigh 0.100, head+neck 0.081, trunk 0.497 (thorax 0.216, abdomen 0.139, pelvis 0.142).
  COM sits at 0.43–0.44 of the segment length from the proximal end for the arm and leg segments. HAT (head, arms,
  trunk) = 0.678, COM at 0.626 of the trochanter→glenohumeral distance from the hip.
- **Forward lean → hips back**: solve for the pelvis x so that COM_x = support centre. With a trunk flexion θ, the HAT
  COM moves forward by ≈ 0.626·L_trunk·sin θ·0.678, so the pelvis/hips move back by roughly that amount divided by the
  pelvis+legs share. Rule of thumb: toe-touch (θ ≈ 90°) → hips go ≈ 15–25 cm behind the ankles, and the ankles
  plantarflex (shanks lean back ≈ 5–10°).
  ```ts
  for (i=0;i<3;i++){ com = computeCOM(pose); err = supportCentre.xz - com.xz; pelvis.xz += err*gain(≈1.2); resolveLegs(); }
  ```
- One-hand far reach: the contralateral arm extends back or sideways as a counterweight, and the contralateral leg may
  lift (a "golfer's reach").

---

## 5. Head and neck

- **Walking stabilisation** (Pozzo, Berthoz & Lefort 1990, https://link.springer.com/article/10.1007/BF00230842):
  - Head pitch in space is stabilised to within a few degrees (≈ ±2–5°, Frankfort plane near horizontal).
  - The head counter-rotates in pitch against the vertical translation (head down when the body goes up), as if looking
    at a fixed point ahead (≈ 1–2 m in front), independent of speed.
  - Head vertical translation matches the trunk bob.
  - Implementation: apply the pelvis bob to the head, then set neck pitch = `−atan2(bobOffset, fixationDist≈1.5 m)`
    plus an opposite share of the thorax pitch. Head yaw relative to the world follows the path, not the pelvis
    (cancel the pelvic/thoracic yaw oscillation at ≈ 70–90 %).
- **Neck ROM** [norm]: axial rotation ±70–80° (about 50 % at C1–C2), flexion 45–50°, extension 60–75°, lateral bend
  ±40–45°. Comfortable range ≈ 50–60 % of these.
- **Eye–head–trunk share of a gaze shift** of amplitude A (yaw):
  - The eye-in-head comfort range is ±15–20°. Shifts below ≈ 15–20° are mostly eye movements, with the head adding a
    small amount.
  - Head contribution ≈ `A − 15°` up to about 60°. At 45° the trunk contribution is negligible
    (https://pmc.ncbi.nlm.nih.gov/articles/PMC4369292/).
  - Beyond ≈ 60°, the trunk/thorax takes over (≈ 20–30 % of the excess). Beyond ≈ 90–120° the feet step, and 90°, 135°,
    and 180° shifts are often done in multiple steps.
  ```ts
  eye   = clamp(A, ±15°)                          // (only if you render eyes; else fold into head)
  head  = clamp(A - eye, ±70°) * (A>60? 0.85 : 1)
  torso = clamp((A - eye - head) + 0.25*max(0, A-60), ±35°)   // distributed thorax 60%, lumbar 40%
  rest  → pelvis yaw / step (trigger turn-in-place when rest > 20–25°)
  // timing: eye 0 ms, head +20–50 ms, torso +100–150 ms, feet +200–300 ms; each with min-jerk durations 150/300/500/600 ms
  ```
- Head pitch when looking down at the hands: neck flexion up to ≈ 30–40°, then the thorax flexes.

---

## 6. Body proportions

### 6.1 Drillis & Contini (1966) segment lengths as a fraction of height H

As reproduced in Winter, *Biomechanics and Motor Control of Human Movement*, Fig. 4.1 [norm].

| Landmark heights | ×H | Segment lengths | ×H |
|---|---|---|---|
| Top of head | 1.000 | Head (top→chin) | 0.130 |
| Eye | 0.936 | Neck (chin→shoulder line) | 0.052 |
| Chin | 0.870 | Shoulder width (biacromial) | 0.259 |
| Shoulder (acromion) | 0.818 | Chest width | 0.174 |
| Nipple | 0.720 | Hip width | 0.191 |
| Elbow | 0.630 | Upper arm | 0.186 |
| Wrist | 0.485 | Forearm | 0.146 |
| Hip (greater trochanter) | 0.530 | Hand | 0.108 |
| Fingertip | 0.377 | Thigh | 0.245 |
| Knee | 0.285 | Shank (knee→ankle) | 0.246 |
| Ankle | 0.039 | Foot length | 0.152 |
| | | Foot width | 0.055 |

For H = 1.75 m: upper arm 0.326, forearm 0.256, hand 0.189, thigh 0.429, shank 0.431, foot 0.266, shoulder width
0.453 m (acromion to acromion; the glenohumeral centres are ≈ 0.20 H apart), hip width 0.334 m (the hip joint centres
are ≈ 0.10–0.11 H apart, not the full 0.191 H). Standing COM ≈ 0.55–0.56 H.

### 6.2 Face / keypoint offsets for OpenPose-style output [heur, anthropometric averages; tune per rig]

Relative to the head centre (≈ the midpoint between the ear canals, in the head frame: +z forward, +y up, +x left).
Adult head length ≈ 0.19–0.20 m, width ≈ 0.15 m.

| Keypoint | Offset (m) |
|---|---|
| Ears (tragus) | (±0.070, 0.000, 0.000) |
| Eyes (pupils) | (±0.032, +0.035, +0.085). Interpupillary distance ≈ 0.063 m |
| Nose tip | (0, 0.000, +0.110) (≈ 0.03 m below the eye line) |
| Chin | (0, −0.085, +0.080) |
| Neck keypoint (OpenPose "Neck", 1) | midpoint of the two shoulder keypoints (not the anatomical C7) |
| MidHip (8) | midpoint of RHip and LHip. OpenPose hips sit about at the hip joint centres |

---

## 7. OpenPose keypoints and colours

### 7.1 BODY_25 order [src]

```
0 Nose  1 Neck  2 RShoulder  3 RElbow  4 RWrist  5 LShoulder  6 LElbow  7 LWrist  8 MidHip
9 RHip  10 RKnee  11 RAnkle  12 LHip  13 LKnee  14 LAnkle  15 REye  16 LEye  17 REar  18 LEar
19 LBigToe  20 LSmallToe  21 LHeel  22 RBigToe  23 RSmallToe  24 RHeel
```

Render pairs (`POSE_BODY_25_PAIRS_RENDER_GPU`,
https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/include/openpose/pose/poseParametersRender.hpp):
```
1-8, 1-2, 1-5, 2-3, 3-4, 5-6, 6-7, 8-9, 9-10, 10-11, 8-12, 12-13, 13-14, 1-0, 0-15, 15-17, 0-16, 16-18,
14-19, 19-20, 14-21, 11-22, 22-23, 11-24
```

Keypoint colours (`POSE_BODY_25_COLORS_RENDER_GPU`, **RGB**, index = keypoint):
```
 0 [255,0,85]   1 [255,0,0]    2 [255,85,0]   3 [255,170,0]  4 [255,255,0]  5 [170,255,0]
 6 [85,255,0]   7 [0,255,0]    8 [255,0,0]    9 [0,255,85]  10 [0,255,170] 11 [0,255,255]
12 [0,170,255] 13 [0,85,255]  14 [0,0,255]   15 [255,0,170] 16 [170,0,255] 17 [255,0,255]
18 [85,0,255]  19 [0,0,255]   20 [0,0,255]   21 [0,0,255]   22 [0,255,255] 23 [0,255,255] 24 [0,255,255]
```
**Limb colour = colour of the pair's second (child) keypoint** (`colorIndex = pairs[pair+1]*3` in
`renderKeypointsCpu`, src/openpose/utilities/keypoint.cpp). The colour array is RGB; OpenPose swaps to BGR for OpenCV.
Resulting limb colours:
```
1-8 [255,0,0]  1-2 [255,85,0]  1-5 [170,255,0]  2-3 [255,170,0]  3-4 [255,255,0]  5-6 [85,255,0]  6-7 [0,255,0]
8-9 [0,255,85] 9-10 [0,255,170] 10-11 [0,255,255] 8-12 [0,170,255] 12-13 [0,85,255] 13-14 [0,0,255]
1-0 [255,0,85] 0-15 [255,0,170] 15-17 [255,0,255] 0-16 [170,0,255] 16-18 [85,0,255]
14-19,19-20,14-21 [0,0,255]   11-22,22-23,11-24 [0,255,255]
```
Sizes (CPU renderer): `thicknessCircleRatio = 1/75`, `thicknessLineRatioWRTCircle = 0.75`.
`thicknessRatio = max(round(√(W·H_img)·(1/75)·ratioAreas), 2)`, where ratioAreas = min(1, max(personW/W, personH/H)).
Circle radius = thicknessRatio/2, line width = 0.75·thicknessRatio. Lines are drawn first, then circles. Default
`--alpha_pose 0.6` (the blend over the input image).

### 7.2 COCO-18 (OpenPose COCO model and ControlNet "openpose")

Order: `0 Nose, 1 Neck, 2 RShoulder, 3 RElbow, 4 RWrist, 5 LShoulder, 6 LElbow, 7 LWrist, 8 RHip, 9 RKnee, 10 RAnkle,
11 LHip, 12 LKnee, 13 LAnkle, 14 REye, 15 LEye, 16 REar, 17 LEar`. BODY_25 → COCO-18 mapping: drop 8 (MidHip) and 19–24,
then shift.

OpenPose COCO pairs: `1-2,1-5,2-3,3-4,5-6,6-7,1-8,8-9,9-10,1-11,11-12,12-13,1-0,0-14,14-16,0-15,15-17`. Its colours are
the BODY_25 list without the MidHip entry (18 entries from [255,0,85] to [85,0,255]), again with limb colour = child
keypoint colour.

**ControlNet** (lllyasviel/ControlNet `annotator/openpose/util.py`, and `controlnet_aux` `open_pose/util.py`) [src].
The colours are **RGB** on a black canvas.
```
limbSeq (1-indexed) = [2,3],[2,6],[3,4],[4,5],[6,7],[7,8],[2,9],[9,10],[10,11],[2,12],[12,13],[13,14],
                      [2,1],[1,15],[15,17],[1,16],[16,18]      (+ [3,17],[6,18] listed but NOT drawn in v1.0 — loop runs 17)
colors = [255,0,0],[255,85,0],[255,170,0],[255,255,0],[170,255,0],[85,255,0],[0,255,0],[0,255,85],[0,255,170],
         [0,255,255],[0,170,255],[0,85,255],[0,0,255],[85,0,255],[170,0,255],[255,0,255],[255,0,170],[255,0,85]
```
- Keypoint i uses colors[i]. **Limb i uses colors[i]** (indexed by limb, not by child keypoint as OpenPose does). For
  example, neck→RShoulder is red [255,0,0] and neck→LShoulder is [255,85,0].
- Limb shape: a filled ellipse (`cv2.ellipse2Poly`) along the bone, half-length = len/2, half-width `stickwidth = 4` px.
  Joints are filled circles of radius 4 px.
- v1.0 (`ControlNet`): each limb is drawn on a copy and blended with `addWeighted(canvas, 0.4, limb, 0.6)`. Joints are
  drawn **first**, so they get dimmed by later limbs.
- `controlnet_aux` / v1.1: limbs are drawn first with colour × 0.6 (`[int(c*0.6)]`) and no blending. Joints are then drawn
  on top at full colour. Coordinates are normalised to [0,1] × (W,H).
- To produce SD-compatible pose images from three.js: project the 3D keypoints, draw on a black background at the
  generation resolution (for example 512 or 768 px), and use the v1.1 style.

---

## 8. Architecture

§8.1–8.2 are the **original proposal**, written before the implementation, and kept for their reasoning. The
implementation took a different route: instead of a VRIK-style stage chain with FABRIK and a final DLS pass, a small
bounded Levenberg–Marquardt posture planner answers both *where to stand* and *how to hold the body*, with gait,
limbs and head layered on top (README, "How it works"). One-Euro input filtering and the idle behaviours of §8.2 are
not implemented. §8.3 lists rules of thumb (guidance, not all implemented); §8.4 is the implemented layout.

### 8.1 Proposed per-frame pipeline (original proposal)

```
Inputs (any subset, each optional): head {pos, rot}, handL/handR {pos, rot?}, torso {pos, rot} (chest or pelvis)
  │
  ├─ 0. Filter & predict    One-Euro filter per tracker (minCutoff≈1.0 Hz, β≈0.007–0.05, dCutoff≈1 Hz);
  │                          velocity estimate; confidence/dropout → blend weight with a 150–300 ms fade.
  ├─ 1. Fill missing inputs (see 8.2) → a full set of "soft" targets with weights
  ├─ 2. Facing & root       VRIK faceDirection from head (+ torso yaw if given, + hands via AdjustChestByHands);
  │                          root yaw follows with maxRootAngle≈25° dead-zone; critically damped (ζ=1, ω≈6–10 rad/s)
  ├─ 3. Locomotion          COM estimate (§4.5 masses or the VRIK 1/1/0.2/0.2 approximation) → capture point →
  │                          step trigger (§3.1) → gait mode {idle, step-adjust, walk(v), turn-in-place} →
  │                          phase φ, speed-dependent parameters (§3.2), footstep plan with heel/toe roll (§3.5)
  ├─ 4. Pelvis              from head: spine-length model + crouch (bodyPosStiffness 0.55, move back 0.5·Δy·headH)
  │                          + LimitPelvisPosition to planted feet + gait offsets (bob/sway/yaw/list/tilt, §3.6)
  │                          + balance shift (§4.5)
  ├─ 5. Spine               FABRIK pelvis→head (if head given), then distribute the chest rotation (weights ∝ (i+1)/n),
  │                          counter-rotation (§3.7), lean from acceleration, reach assistance (hand beyond reach → lean/twist)
  ├─ 6. Shoulders & arms    clavicle rule (§2.4) → swivel φ from Soechting (§2.1) ⊕ heuristic (§2.2) ⊕ thumb blend →
  │                          analytic two-bone with soft extension → forearm twist split (wrist twist distributed
  │                          ≈ 50–70 % to the forearm twist bone) → hand rotation
  ├─ 7. Legs & feet         analytic two-bone to the ankle; knee pole from foot direction (§2.3); foot pitch from the
  │                          roll phase; toe bend at the MTP when the heel lifts
  ├─ 8. Head/neck/eyes      gaze target (next hand goal, else path ahead, else tracker) → eye/head/torso split (§5),
  │                          walking stabilisation; if the head tracker exists, the head is hard-constrained and only the neck/chest split changes
  ├─ 9. Refine (optional)   2–3 DLS iterations of §1.6 (limits, comfort, balance, smoothness); joint-limit clamp (swing-twist)
  └─ 10. Output             bone quaternions → three.js Skeleton; FK keypoints → BODY_25 / COCO-18 (+ renderer, §7)
```

### 8.2 Proposed missing-input inference policy (original proposal)

| Given | Infer |
|---|---|
| Head only | Pelvis via the VRIK spine model. Hands: hanging (shoulder flexion ≈ 5°, abduction ≈ 10°, elbow ≈ 15°) + gait arm swing. Gaze = head |
| Hands only | Head above the chest along the spine. Gaze at the more active hand or the midpoint of the hands (§4.2). Chest yaw/roll from AdjustChestByHands. Pelvis height from standing height minus crouch, where crouch is triggered when the hands are below ≈ 0.35 H (§4.3). Root follows the hands' centroid with a lag |
| Torso only | Head: neutral neck, gaze horizon/path. Arms: hang + swing |
| Head + hands | Full VRIK behaviour |
| Torso + anything | The torso is the strongest pelvis/spine constraint. Set pelvisPositionWeight=1 when the torso tracker is on the pelvis, chestGoal when it is on the chest |
| Nothing moving | Idle: breathing (chest pitch ±1°, period 3–5 s), weight shift between feet every 5–15 s (pelvis lateral 2–4 cm), micro head motion (Perlin, ±1–2°) |

### 8.3 Motion-quality rules of thumb

1. Every target reaches its bone through a **critically damped spring or a min-jerk re-planner**. Never snap. Use
   hands τ ≈ 60–100 ms (the tracker is truth) and the root/pelvis ≈ 150–300 ms.
2. **Temporal offsets create life**: eyes → head (+30 ms) → chest (+120 ms) → pelvis (+200 ms) → feet (+250 ms).
3. **Asymmetry and noise**: ±5–10 % random variation in step duration and length (VRIK randomises the step speed by
   ×1–1.5), a left/right bias, Perlin sway.
4. **No foot sliding**: stance feet are locked in the world. Only the step planner moves them. Lock pivot points (heel
   → toe) during roll.
5. **Pole continuity**: keep the swivel φ continuous (filter φ, not the pole point) and never let the pole vector
   cross the limb axis (use the previous φ when the hint is degenerate).
6. **Soft limits over hard clamps**: apply joint limits as swing-twist cones with smooth saturation (tanh), and
   rebalance the leftover to parent joints.

### 8.4 Module layout (implemented, `packages/core/src`)

```
humanoid.ts   Humanoid(model): the public entry; one fixed step = intent → planner → gait → posture → limbs → pose,
              written to the model
input.ts      Input / Options / Target types; proportions.ts (Drillis–Contini from H), stance.ts
intent/       what the targets ask for: reach, seat, tracked-path detection, tasks for the planner
posture/      the posture model and its LM solver (plan, cost terms, trunk FK, give-way, settling springs)
gait/         locomotion: root follow, step timing (walk ratio) and placement, swing arcs over obstacles,
              foot roll, turning, and the gait overlays (pelvis bob/sway, counter-rotation)
limbs/        analytic two-bone IK for arms and legs, clavicle and swivel, head/neck/gaze split
pose/         bones, joints (incl. BODY_25 face and foot points), VRM rotations, centre of mass
rig.ts        the @pmndrs/viverse character model (VRM or glTF) as driven: proportions measured from its rest
              pose, landmark nodes added, bones posed as viverse retargets VRM clips
skeleton.ts   createSkeletonModel: bare VRM-named bones in the Drillis–Contini proportions, as viverse loads a glTF
```
The OpenPose output (§7) is the separate `@prohuman/openpose` package: a skeleton model drawn as BODY_25.

---

## Sources

- Final IK VRIK source mirror: https://github.com/xyonico/CustomAvatarsPlugin/tree/master/CustomAvatar/VRIK ; docs http://www.root-motion.com/finalikdox/html/page16.html ; https://wiki.resonite.com/Component:VRIK
- FABRIK: http://www.andreasaristidou.com/FABRIK.html
- Tolani, Goswami, Badler 2000 (IKAN, swivel angle): https://repository.upenn.edu/hms/41/
- Koga, Kondo, Kuffner, Latombe 1994 (Soechting–Flanders equations): https://www.ri.cmu.edu/pub_files/pub4/koga_yoshihito_1994_1/koga_yoshihito_1994_1.pdf
- Soechting & Flanders 1989: https://journals.physiology.org/doi/abs/10.1152/jn.1989.62.2.595 , https://journals.physiology.org/doi/abs/10.1152/jn.1989.62.2.582
- Unity Animation Rigging: https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/index.html ; Unreal IK Rig solvers: https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-solvers-in-unreal-engine
- Walk ratio: https://pubmed.ncbi.nlm.nih.gov/29494821/
- COM displacement vs speed: https://pubmed.ncbi.nlm.nih.gov/15685471/ ; pelvic rotation: https://pubmed.ncbi.nlm.nih.gov/11239313/ ; pelvic obliquity: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10229507/
- Foot clearance: https://pubmed.ncbi.nlm.nih.gov/1728048/ ; https://www.nature.com/articles/s41598-017-02189-y ; https://pubmed.ncbi.nlm.nih.gov/21354576/
- Thorax–pelvis coordination: https://pubmed.ncbi.nlm.nih.gov/17669652/ ; https://www.nature.com/articles/s41598-018-37549-9
- Arm swing: https://www.sciencedirect.com/science/article/abs/pii/S016794571630077X
- Head stabilisation: https://link.springer.com/article/10.1007/BF00230842
- Gaze shifts eye/head/trunk: https://pmc.ncbi.nlm.nih.gov/articles/PMC4369292/ ; https://pubmed.ncbi.nlm.nih.gov/20198364/ ; https://pmc.ncbi.nlm.nih.gov/articles/PMC6879955/
- Turning: https://pmc.ncbi.nlm.nih.gov/articles/PMC8074235 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10832107/
- Eye–hand timing: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3045308/ ; https://pmc.ncbi.nlm.nih.gov/articles/PMC3945424/
- Lifting: https://link.springer.com/article/10.1186/1471-2474-10-15 ; https://medcraveonline.com/MOJYPT/choosing-a-lifting-posture-squat-semi-squat-or-stoop.html
- Anthropometry (Drillis & Contini via Winter; Dempster masses): https://courses.grainger.illinois.edu/me481/sp2021/Anthro-Winter.pdf
- OpenPose rendering: https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/include/openpose/pose/poseParametersRender.hpp ; https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/src/openpose/utilities/keypoint.cpp
- ControlNet: https://github.com/lllyasviel/ControlNet/blob/main/annotator/openpose/util.py ; https://github.com/huggingface/controlnet_aux/blob/master/src/controlnet_aux/open_pose/util.py
- Classic references (not fetched; standard values): Flash & Hogan 1985 (J Neurosci 5:1688); Raibert 1986; Pratt et al. 2006 (capture point); Perry, *Gait Analysis*; Inman, *Human Walking*; Kirtley CGA normative data; Land & Hayhoe 2001; Grasso et al. 1998; Inman 1944 (scapulohumeral rhythm); AAOS joint ROM.
