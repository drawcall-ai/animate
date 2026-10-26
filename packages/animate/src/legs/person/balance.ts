// A person's body over its root, whoever drives it: the core stepper keeps the legs under it; here the carriage, the leg chains and the human checks.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Dev } from '../../kernel/dev';
import { solveChain } from '../../kernel/chain';
import { follow } from '../../kernel/follow';
import { clampRotation } from '../../kernel/limits';
import { clamp, forwardOf, lerp, minimumJerk, pointSegmentDistance, smoothstep, wrapAngle, yawOf } from '../../kernel/math';
import { Stepper } from '../step/stepper';
import { type Feet, type Leg, type RootGoal } from '../step/state';
import { TrackedPoint, TrackedRotation } from '../../kernel/track';
import { Poise } from '../../kernel/poise';
import type { Go, Stance } from '../../kernel/go';
import { seedOf } from '../../kernel/random';
import { Life } from './life';
import { ankleFor, ballOf, footRotation, heelOf } from './foot';
import { kneePole, shankTilt } from './leg';
import { BOW, PELVIS, TURN, followed } from './pace';
import { LOWER, Posture, entrain, walking, type Trunk, type Upright } from './posture';
import { armsHeld } from './turn';
import { hullOf, outside, xcomOfPoses } from '../support';
import { INDEX, SIDES, type Side } from '../../species/humanoid/bones';
import type { PersonLegged } from './legged';
import type { Step } from '../../kernel/frame';
import { drivenRoot } from '../driven';
import { solePoints } from '../../species/humanoid/landmarks';
import { humanStepping } from './stepping';
import { KNEE_FLEXION } from '../../species/humanoid/limits';
import { defaultStance, standingFeet } from '../../species/humanoid/stance';

/**
 * How quickly a person's legs take it up to a pace and down from it (m/s²), which the trunk carries itself at — its lean into the
 * acceleration (`Inertia`) and its walking lean — however quick the root: read (Leteneur et al. 2013, PLoS ONE 8:e55256), setting off the
 * centre of mass is at 1.0 m/s by the first heel strike 0.96 s on, ~1 m/s², the trunk leaning ~7° over that step; read (Crenna, Cuong &
 * Brenière 2001, J Physiol, PMC2279001), stopping from a fast walk takes one stride in 98% of trials (30% from a natural one); recalled,
 * people brake about twice as hard as they speed up (the planner's `BRAKE_FACTOR` 2.2). Tuned: 1.5 and 3.3 — a player's 10 m/s² set-off
 * no longer throws the trunk 3° → 15° at ~100°/s, nor a stop back at ~45°/s; a planner's root, paced already, is carried as it goes.
 */
const PACE = { push: 1.5, brake: 3.3 };
/**
 * Tuned: the ankles' middle stands this far behind the centre of mass (m; the old balance stood it `OVER_ANKLES` ahead of them; walking,
 * less leaves the extrapolated centre of mass past the toes as the trailing foot lifts, more lowers the pelvis before contact)
 */
const OVER = 0.021;
/**
 * Tuned (rad): crouched with its hips sitting back behind its feet, the trunk bows this far forward at the deepest, bringing its mass
 * back over them — upright, a full crouch leaves the centre of mass ~1 cm behind the heels
 */
const CROUCH_LEAN = 0.3;
/**
 * Tuned: walking, a body lets its pelvis down at most this share of a squat (the old balance's deepest dip walking, reaching low:
 * ~0.26 m); a deeper ask waits for it to slow
 */
const WALKING_CROUCH = 0.5;
/** Inherited (the old balance): let down or up this far (m), the feet stay put but to catch a fall */
const LOWERED = 0.02;
/**
 * Tuned within the hip's ~35–45° of turn (recalled: AAOS ranges): a swinging knee points at most this far (rad) off the pelvis's facing
 * (with its toe-out); tuned: eased in over this share of the swing
 */
const KNEE_OFF = 0.35, KNEE_EASE = 0.3;
/** Development bounds: planted pivot slide (m), touchdown speeds (m/s), closest shanks (m, ~their thickness), logged-only XCoM (m). */
const LIMIT = { slide: 0.001, vertical: 0.1, horizontal: 1, across: 0.06, xcom: 0.1 };

/**
 * Legs under a root the app drives (`drive`, read every sub-step; see `Stepper`) — its hips over the floor, as a game's character
 * capsule carries them: a leap it asks is taken as soon as the feet can, and `airborne` says when it is in the air; the body over it is
 * carried as a walker's is (`drivenBy`). Development checks: planted slide, touchdown speed, feet across; the XCoM is only noted.
 */
export function driven(h: PersonLegged, seed?: number): Step {
  const root = drivenRoot(h);
  return drivenBy(h, (f) => root(f), { seed });
}

/**
 * A person's root as the stepper takes it, at the hips (a scene's: the feet under them) or at the body's centre of mass (`centre`, a
 * planner's: the hips holding it there, the feet's middle `OVER` behind it); and whether a walk is under way on it (`underway`, a
 * planner's: from its start till it stops), else as the body moves.
 */
export interface PersonRoot extends RootGoal {
  centre?: boolean;
  underway?: boolean;
}

/**
 * `driven`, the root read each sub-step from `rootOf` once what was asked is taken (a scene's; a planner's, toward where its legs are asked to go). Whoever
 * drives it, the body is carried over it one way, as `Posture` has it: the hips swaying and turning with the stride about the root
 * (off a centre of mass's as far as the body's mass leans ahead of them), the trunk leaning with the pace its legs could have taken it
 * to (`PACE`), nodding, bowed and twisted as asked, the thorax counter-rotating. Let down as asked (`lower`) or as the root crouches it,
 * the legs crouch (below none: up on the toes). Standing, it breathes, sways and shifts its weight now and then (seeded by `seed`),
 * less as it holds still (`steady`).
 */
export function drivenBy(
  h: PersonLegged,
  rootOf: (f: Frame, go: Go | null, poise: Poise, stepper: Stepper) => PersonRoot,
  options: { stance?: Partial<Stance>; seed?: number } = {},
): Step {
  const p = h.proportions, s = p.scale;
  const soles = SIDES.map((side, i) => [heelOf(p), ...[p.sole.bigToe, p.sole.smallToe]
    .map((tip) => tip.clone().setX(tip.x * (i === 0 ? 1 : -1)).add(ballOf(p, side)))]);
  const feet: Feet = {
    hip: p.hipHalfWidth,
    length: p.legLength,
    thigh: p.thigh,
    shin: p.shin,
    fold: KNEE_FLEXION * Math.PI / 180,
    ankleHeight: p.ankleHeight,
    rotation: footRotation,
    legs: SIDES.map((side, i) => ({
      sign: i === 0 ? 1 : -1,
      foot: INDEX[`${side}Foot`],
      toes: INDEX[`${side}Toes`],
      top: INDEX[`${side}UpperLeg`],
      up: p.offsets[`${side}UpperLeg`].y,
    })),
    ankle: (i, anchor, yaw, pitch, out) => ankleFor(p, SIDES[i], anchor, yaw, pitch, out),
    lean: (i, pose, yaw) => shankTilt(pose, SIDES[i], yaw),
    print: (i, anchor, yaw) => soles[i].map((point): [number, number] => {
      const at = point.clone().applyQuaternion(footRotation(yaw, 0)).add(anchor);
      return [at.x, at.z];
    }),
    sole: (i, ankle, foot, toes) => {
      const ball = ballOf(p, SIDES[i], _b).applyQuaternion(foot).add(ankle);
      const sign = i === 0 ? 1 : -1;
      const heel = heelOf(p, _a).applyQuaternion(foot).y + ankle.y;
      const tips = [p.sole.bigToe, p.sole.smallToe].map((tip) => _a.copy(tip).setX(tip.x * sign).applyQuaternion(toes).y + ball.y);
      return Math.min(heel, ...tips);
    },
  };
  // (a person's stepping, as its root foresees where it goes or not — told by the root it is first given)
  // (the feet where they stand as it is made: in its stance under it)
  const standing = standingFeet(p, h.pose.position(0).x, h.pose.position(0).z, h.yaw);
  const stepperFor = (foreseen: boolean) => (h.stepper = new Stepper(humanStepping(p, foreseen), feet, standing, h.yaw));
  let stepper = stepperFor(true), first = true;
  const { toeOut, crouch: crouching } = humanStepping(p);
  const poise = new Poise();
  const base = { ...defaultStance(p), ...options.stance };
  const upright: Upright = {
    p,
    root: new Vector3(),
    velocity: new Vector3(),
    offset: new Vector3(),
    yaw: h.yaw,
    walk: 0,
    run: 0,
    moving: false,
    stance: base,
    // (where the feet stood as the sub-step began: the posture shifts the weight between them)
    feet: standing.map((foot) => ({ anchor: foot.position.clone() })),
    pelvis: new Vector3(),
    pelvisRotation: new Quaternion(),
    held: false,
  };
  const posture = new Posture(h.species.inertia);
  const life = new Life(options.seed ?? seedOf(p.height, standing[0].position.x, standing[0].position.z));
  const trunk: Trunk = { chest: new Quaternion(), pelvisYaw: 0, thoraxYaw: 0 };
  const asked = { lower: [0, 0], bow: [0, 0], twist: [0, 0] };
  const hips = new TrackedPoint(), rotation = new TrackedRotation(), back = [new TrackedRotation(), new TrackedRotation()];
  const tilts = [new Quaternion(), new Quaternion()];
  let offsets: Vector3[] | null = null, pace: Vector3 | null = null, phase = 0;
  return (f) => {
    if (f.dev && f.time > f.dt) check(h, f, f.dev, stepper.legs);
    h.poise.pass(poise);
    const dt = f.dt, go = h.going, root = rootOf(f, go, poise, stepper);
    if (first && !root.forecast) stepper = stepperFor(false);
    first = false;
    // (the hips off the root first as they stand: off a scene's root, off the centre of mass a planner's starts at)
    if (!offsets) {
      const from = root.centre ? f.prev.com(new Vector3()).setY(0) : root.position;
      offsets = [f.prev2.position(0).clone().sub(from).setY(0), f.prev.position(0).clone().sub(from).setY(0)];
    }
    // the hips carried off the root: swaying and turning with the stride, off a centre of mass's as far as the mass leans ahead of them
    const speed = root.velocity.length();
    upright.stance = go?.stance ? { ...base, ...go.stance } : base;
    upright.walk = walking(upright.walk, speed, dt);
    upright.moving = root.underway ?? h.locomotion.moving;
    upright.yaw = stepper.yaw;
    upright.held = armsHeld(h);
    upright.root.copy(root.position);
    // (the trunk carries itself — leaning, running — at the pace its legs could have taken it to, within `PACE`: a player's quicker root
    // does not throw it; spawned on the move, at that pace)
    pace ??= new Vector3(root.velocity.x, 0, root.velocity.z);
    const change = _v.set(root.velocity.x, 0, root.velocity.z).sub(pace);
    const most = (change.dot(pace) < 0 ? PACE.brake : PACE.push) * dt;
    if (change.length() <= most) pace.set(root.velocity.x, 0, root.velocity.z);
    else pace.addScaledVector(change, most / change.length());
    upright.velocity.copy(pace);
    upright.run = stepper.run;
    if (root.centre) upright.offset.copy(posture.center(f));
    // (its quiet life: motion blends it out, the hands' too, as balance's: a quick turn of what they hold is not breathed through)
    const activity = Math.max(speed, ...[INDEX.leftHand, INDEX.rightHand].map((tip) =>
      f.prev.position(tip).distanceTo(f.prev2.position(tip)) / dt));
    life.update(dt, life.quiet(go, poise, h), activity, poise.steady);
    // (let down, bowed and twisted at a squat's pace — or twisted at the rate asked, the trunk's joints pacing it within `TURN`: an aim
    // tracks a turning look)
    const twisting = poise.twistRate * dt;
    const twist = twisting > 0
      ? asked.twist[1] + clamp(poise.twist - asked.twist[1], -twisting, twisting)
      : follow(asked.twist[0], asked.twist[1], poise.twist, BOW, dt);
    [asked.twist[0], asked.twist[1]] = [asked.twist[1], twist];
    const requested = {
      lower: followed(asked.lower, poise.lower, LOWER, dt),
      bow: followed(asked.bow, Math.min(poise.bow, poise.bowLimit), BOW, dt),
      twist,
    };
    const swing = stepper.legs.find((leg) => leg.swing)?.swing;
    // (the stride's phase pulled into step with the feet's, never jumping as a foot lifts; running, the stance leg compresses toward
    // mid-stance, as the stepper lets the pelvis down)
    phase = entrain(phase, stepper.phase, 2 * Math.PI / stepper.cycle, dt);
    const compressed = (leg: Leg) => leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / stepper.Ts)) ** 2;
    const compression = Math.min(1, stepper.legs.reduce((sum, leg) => sum + compressed(leg), 0));
    // (crouched over a root at its hips — sitting back behind the feet, the mass not held over the root — the trunk bows over them by
    // `CROUCH_LEAN`, as the legs take the crouch)
    const stoop = root.centre ? 0 : CROUCH_LEAN * stepper.crouch;
    const cycle = {
      phase,
      bob: swing ? Math.sin(Math.PI * swing.u) : 0,
      nod: swing ? Math.cos(2 * Math.PI * swing.u) : 1,
      compression,
      stance: stepper.Ts / stepper.cycle,
    };
    posture.carry(f, upright, { ...requested, bow: requested.bow + stoop }, trunk, life, cycle, (height) => height);
    const offset = hips.follow(offsets[0], offsets[1], upright.pelvis.clone().sub(upright.root).setY(0), PELVIS, dt, new Vector3());
    [offsets[0], offsets[1]] = [offsets[1], offset];
    // (the pelvis's turn with the stride followed off the facing; running, the legs are told of it before they reach from its hips —
    // reversed, it swings the stance hip back off its foot; walking, they reach from a pelvis square to its facing, as a walker's do)
    const square = new Quaternion().setFromAxisAngle(UP, -upright.yaw).multiply(upright.pelvisRotation);
    const tilt = rotation.follow(tilts[0], tilts[1], square, TURN, dt, new Quaternion());
    [tilts[0], tilts[1]] = [tilts[1], tilt.clone()];
    stepper.turn = yawOf(tilt) * upright.run;
    // (the stepper given the feet's middle — a centre of mass's `behind` it, the hips that far ahead of it again; let down as asked or
    // as the root crouches it, the feet staying put; balance read off the body as it last stood, as the checks read it)
    const behind = root.centre ? feetBehind(stepper, s) : ZERO, forecast = root.forecast;
    const lowered = crouchFor(requested.lower / (crouching.depth * s));
    const walkingMost = lerp(1, WALKING_CROUCH, smoothstep(0.2, 0.8, speed));
    stepper.move(f, {
      ...root,
      position: root.position.clone().sub(behind),
      forecast: forecast && ((t) => {
        const at = forecast(t);
        return { position: at.position.sub(behind), yaw: at.yaw };
      }),
      // Remove the pelvis compensation from its offset: only the remaining sway and tracking lag displace the mass.
      hips: offset.clone().add(behind),
      com: root.centre ? offset.clone().sub(upright.offset).add(behind) : undefined,
      crouch: Math.max(root.crouch ?? 0, Math.min(lowered, walkingMost)),
      tiptoe: Math.max(0, -requested.lower),
      still: !upright.moving && Math.abs(requested.lower) > LOWERED * s,
      xcom: xcomOfPoses(f.prev, f.prev2, dt, p.legLength, new Vector3()),
    });
    const { yaw, moving, run, legs } = stepper;
    // the pelvis turned with the stride over the stepper's facing; the lower back and thorax each take half the turn up to the chest
    f.current.setLocal(0, tilt.premultiply(new Quaternion().setFromAxisAngle(UP, yaw)));
    const chest = new Quaternion().setFromAxisAngle(UP, yaw - upright.yaw).multiply(trunk.chest);
    const half = f.current.local(0).clone().invert().multiply(chest).slerp(new Quaternion(), 0.5);
    [INDEX.spine, INDEX.chest].forEach((bone, k) => {
      const local = half.clone(), limit = f.current.skeleton.limits[bone];
      if (limit) clampRotation(local, limit);
      f.current.setLocal(bone, back[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TURN, dt, new Quaternion()));
    });
    // the legs down to the feet
    legs.forEach((leg, i) => {
      const side = SIDES[i], thigh = f.current.position(INDEX[`${side}UpperLeg`]);
      const pose = stepper.pose(i, thigh);
      // (swinging, the knee goes the way the foot points, but no further off the pelvis's way than `KNEE_OFF`: a foot still turned far
      // out leaves no knee swung out with it — eased in over the swing's first `KNEE_EASE`, not snapped round as it lifts)
      const along = stepper.yaw + leg.sign * toeOut, kept = along + clamp(wrapAngle(pose.yaw - along), -KNEE_OFF, KNEE_OFF);
      const yawed = leg.swing ? pose.yaw + wrapAngle(kept - pose.yaw) * minimumJerk(leg.swing.u / KNEE_EASE) : pose.yaw;
      const pole = kneePole(side, yawed, along, thigh, pose.ankle, _pole).multiplyScalar(p.thigh).add(thigh);
      // The pole guides the free swing; the chain progressively takes the foot orientation needed for contact.
      const place = (at: Vector3) => {
        solveChain(f, `${side}Leg`, { tip: { position: at, quaternion: leg.swing ? undefined : pose.foot }, pole });
        const ankle = _local.copy(f.current.rotation(INDEX[`${side}LowerLeg`])).invert().multiply(pose.foot);
        const ankleRange = f.current.skeleton.limits[INDEX[`${side}Foot`]];
        const unrestricted = leg.swing ? ankle.clone() : null;
        if (ankleRange) clampRotation(ankle, ankleRange);
        // Prepare the planted orientation during terminal swing instead of changing the chain's constraints at contact.
        if (leg.swing && leg.swing.u > 0.5 && unrestricted && ankle.angleTo(unrestricted) > 1e-6) {
          const landing = f.current.rotation(INDEX[`${side}LowerLeg`]).clone().multiply(ankle)
            .slerp(pose.foot, minimumJerk((leg.swing.u - 0.5) / 0.5));
          solveChain(f, `${side}Leg`, { tip: { position: at, quaternion: landing }, pole, twist: 0 });
          ankle.copy(f.current.rotation(INDEX[`${side}LowerLeg`])).invert().multiply(landing);
          if (ankleRange) clampRotation(ankle, ankleRange);
        }
        f.current.setLocal(INDEX[`${side}Foot`], ankle);
        // (planted, the toes lie on the floor; swinging, they keep their own bend whatever the ankle's range left of the foot's turn)
        const toes = _local.copy(leg.swing ? pose.foot : f.current.rotation(INDEX[`${side}Foot`])).invert().multiply(pose.toes);
        const range = f.current.skeleton.limits[INDEX[`${side}Toes`]];
        if (range) clampRotation(toes, range);
        f.current.setLocal(INDEX[`${side}Toes`], toes);
      };
      place(pose.ankle);
      // (a swinging foot the ankle's range turned off its plan — toes down past it, behind a crouch — lifted as far as that put it into the floor)
      if (leg.swing) {
        const ankle = f.current.position(INDEX[`${side}Foot`]);
        const sunk = -feet.sole(i, ankle, f.current.rotation(INDEX[`${side}Foot`]), f.current.rotation(INDEX[`${side}Toes`]));
        if (sunk > 0) place(_lift.copy(pose.ankle).setY(pose.ankle.y + sunk));
      }
    });
    legs.forEach((leg, i) => upright.feet[i].anchor.copy(leg.anchor));
    const locomotion = h.locomotion, stepping = legs.some((leg) => leg.swing);
    locomotion.phase = stepper.phase;
    locomotion.walk = moving;
    locomotion.run = run;
    locomotion.facing = wrapAngle(yaw);
    locomotion.facingAhead = wrapAngle(yaw);
    // (a walker's walk under way, as its planner says — its weight shifting over planted feet is none; a player's root moving)
    locomotion.moving = (root.underway ?? Math.hypot(root.velocity.x, root.velocity.z) > 0.05) || stepping;
    locomotion.pelvisYaw = trunk.pelvisYaw;
    locomotion.thoraxYaw = trunk.thoraxYaw;
    locomotion.velocity.copy(root.velocity).setY(0);
    locomotion.planted = locomotion.moving ? 0 : locomotion.planted + dt;
    locomotion.settled = stepper.settled;
    locomotion.quiet.copy(posture.quiet);
  };
}

/** Final-pose checks of the last sub-step, against the legs as they were posed then. */
function check(h: PersonLegged, f: Frame, dev: Dev, legs: readonly Leg[]) {
  const p = h.proportions, time = f.time - f.dt;
  legs.forEach((leg, i) => {
    const side = SIDES[i], bone = INDEX[`${side}Foot`];
    if (leg.swing) {
      const sink = -Math.min(...solePoints(h.proportions, f.prev, side).map((at) => at.y));
      if (sink > 0.002) dev.append(time, { check: 'driven swing sole sink (m)', value: sink, limit: 0.002, where: `${side}Foot` });
      return;
    }
    const pivots = leg.pitch > 0 ? [heelOf(p)] : leg.pitch < 0 ? [ballOf(p, side)] : [heelOf(p), ballOf(p, side)];
    for (const pivot of pivots) {
      const at = f.prev.point(bone, pivot, new Vector3());
      const slide = at.distanceTo(pivot.clone().applyQuaternion(footRotation(leg.yaw, 0)).add(leg.anchor));
      if (slide > LIMIT.slide) dev.append(time, { check: 'driven planted slide (m)', value: slide, limit: LIMIT.slide, where: `${side}Foot` });
      if (!leg.landed) continue;
      const was = f.prev2.point(bone, pivot, new Vector3());
      const vertical = Math.abs(at.y - was.y) / f.dt, horizontal = Math.hypot(at.x - was.x, at.z - was.z) / f.dt;
      // (landing a leap the foot comes down with the body, the knees taking up the fall after: only its horizontal speed is bounded)
      if (vertical > LIMIT.vertical && !leg.leapt) {
        dev.append(time, { check: 'driven touchdown vertical speed (m/s)', value: vertical, limit: LIMIT.vertical, where: `${side}Foot` });
      }
      if (horizontal > LIMIT.horizontal) {
        dev.append(time, { check: 'driven touchdown horizontal speed (m/s)', value: horizontal, limit: LIMIT.horizontal, where: `${side}Foot` });
      }
    }
  });
  // (the shanks never closer than their thickness: legs that cross pass through each other)
  const shank = (side: Side) => [f.prev.position(INDEX[`${side}LowerLeg`]), f.prev.position(INDEX[`${side}Foot`])];
  const [left, right] = [shank('left'), shank('right')];
  const gap = Math.min(...[0, 0.25, 0.5, 0.75, 1].flatMap((k) => [
    pointSegmentDistance(new Vector3().lerpVectors(left[0], left[1], k), right[0], right[1]),
    pointSegmentDistance(new Vector3().lerpVectors(right[0], right[1], k), left[0], left[1]),
  ]));
  if (gap < LIMIT.across * p.scale) {
    dev.append(time, { check: 'driven legs crossed (m)', value: LIMIT.across * p.scale - gap, limit: 0, where: 'legs' });
  }
  // Noted only: a driven body follows its input, not its balance.
  const support = legs.flatMap((leg, i) => leg.swing ? [] : solePoints(h.proportions, f.prev, SIDES[i]).map((at): [number, number] => [at.x, at.z]));
  if (!support.length) return;
  const xcom = xcomOfPoses(f.prev, f.prev2, f.dt, p.legLength, new Vector3());
  const value = outside(hullOf(support), xcom);
  if (value > LIMIT.xcom) dev.note(time, { check: 'driven XCoM outside support (m)', value, limit: LIMIT.xcom, where: 'hips' });
}

/** where the feet's middle stands from the centre of mass (`OVER` behind it, facing as the stepper does; × `scale`) */
export const feetBehind = (stepper: Pick<Stepper, 'yaw'>, scale: number) => forwardOf(stepper.yaw).multiplyScalar(OVER * scale);

/** the crouch (0 … 1) that lets the pelvis down `share` of the stepper's depth (its `minimumJerk` easing undone) */
function crouchFor(share: number): number {
  if (share <= 0 || share >= 1) return clamp(share, 0, 1);
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 24; k++) [lo, hi] = minimumJerk((lo + hi) / 2) < share ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  return (lo + hi) / 2;
}

const UP = new Vector3(0, 1, 0), ZERO = new Vector3(), _local = new Quaternion();
const [_a, _b, _pole, _v, _lift] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
