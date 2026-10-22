// A player's body: the core stepper keeps the legs under the root the scene drives; here the trunk, the leg chains and the human checks.
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import type { Dev } from '../core/dev';
import { solveChain } from '../core/chain';
import { follow } from '../core/follow';
import { live, type Behaviour, type Live } from '../core/goal';
import { clampRotation } from '../core/limits';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, pointSegmentDistance, quatYXZ, wrapAngle } from '../core/math';
import { Stepper, type DrivenRoot, type Feet, type Leg, type RootGoal, type Stepping } from '../core/legs/stepper';
import { TrackedRotation } from '../core/track';
import { createAsks, takeAsks, type Asks } from '../core/asks';
import { ankleFor, ballOf, footRotation, heelOf } from './posture/foot';
import { kneePole, shankTilt } from './posture/leg';
import { hullOf, outside, xcomOfPoses } from '../core/legs/support';
import { INDEX, SIDES, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { solePoints } from './landmarks';
import { humanStepping } from './legs';
import { KNEE_FLEXION } from './profile/limits';

/** Tuned: the trunk leaning forward crouched and into a run (rad), following within `TRUNK` (rad/s²); recalled (CMU mocap, as the balance posture has it): it nods ~±1.2° walking, ~±3° running (rad, peak). */
const CROUCH_LEAN = 0.3, RUN_LEAN = 0.12, TRUNK = { accel: 60 }, NOD = { walk: 0.06, run: 0.09 };
/** Recalled: anterior pelvic tilt grows with speed (~5° walking, ~15° running; Novacheck 1998); tuned: changing within `accel` (rad/s²). */
const TILT = { walk: 0.06, run: 0.25, accel: 8 };
/**
 * Read (Novacheck 1998): the pelvis turns forward on the side of the leg in midswing, the shoulders counter-rotating about it; here
 * the thorax keeps square to the facing. Tuned: ±2° (rad, peak) — recalled, the pelvis turns ±4–6°, but this pelvis does not sway
 * aside as a free one does, and more would swing the leaning chest wider than it.
 */
const PELVIC_ROTATION = 0.035;
/**
 * Recalled (Orendurff et al. 2004): the pelvis sways ~3–5 cm peak to peak over the stance foot walking, a runner's less; tuned: ±1.4 cm
 * walking, ±0.9 cm running (m, default body) — one sinusoid a stride, followed within `accel` (m/s²), the root kept exact — a player's camera and movement ride the root, not the hips
 */
const SWAY = { walk: 0.014, run: 0.009, accel: 1 };
/**
 * Recalled (CMU mocap, as the balance posture has it): the thorax counter-rotates against the pelvis and rolls with its rotation, the
 * forward shoulder up; tuned: `turn` × the pelvis's turn back the other way, rolled `roll` × that
 */
/** Tuned (rad/m): the trunk leans back over the sway a little, the chest riding the pelvis no wider than it */
const KEEP = 1;
const COUNTER = { turn: 1.5, roll: -1 };
/**
 * Read (Novacheck 1998): the trunk leans forward to speed up, keeping the ground's push behind the centre of mass; tuned: `share` of
 * the lean atan(a / g) that would put it through the centre of mass, at most `ahead` (rad), and back slowing down at most `back`.
 */
const SPEEDING = { share: 0.4, ahead: 0.35, back: 0.15 };
/** Tuned within the hip's ~35–45° of turn (recalled: AAOS ranges): a swinging knee points at most this far (rad) off the pelvis's facing (with its toe-out); tuned: eased in over this share of the swing */
const KNEE_OFF = 0.35, KNEE_EASE = 0.3;
/** Development bounds: planted pivot slide (m), touchdown speeds (m/s), closest shanks (m, ~their thickness), logged-only XCoM (m). */
const LIMIT = { slide: 0.001, vertical: 0.1, horizontal: 1, across: 0.06, xcom: 0.1 };

/**
 * Legs under a root the scene drives (`root`, read every sub-step; see `Stepper`): `h.stepper` takes a `jump` and says when
 * it is `airborne`. The pelvis tips forward with the stride; the trunk takes `h.asks.bow` and `twist`, nods as each foot takes
 * the weight; the pelvis' height is the legs' own (`crouch`, a leap): `lower` is not taken.
 * Development checks: planted slide, touchdown speed, feet across; the XCoM is only noted.
 */
export function driven(h: Humanoid, root: Live<DrivenRoot>): Behaviour {
  return drivenBy(h, (f) => live(root, f));
}

/** `driven`, the root read each sub-step from `rootOf` once the tasks' asks are taken (a planner's, toward `asks.go`). */
export function drivenBy(h: Humanoid, rootOf: (f: Frame, asks: Asks, stepper: Stepper) => RootGoal,
  carry?: (f: Frame, asks: Asks, stepper: Stepper) => number, record: Stepping = humanStepping(h.proportions)): Behaviour {
  return function* () {
    const p = h.proportions;
    const soles = SIDES.map((side, i) => [heelOf(p), ...[p.sole.bigToe, p.sole.smallToe]
      .map((tip) => tip.clone().setX(tip.x * (i === 0 ? 1 : -1)).add(ballOf(p, side)))]);
    const feet: Feet = { hip: p.hipHalfWidth, length: p.legLength, thigh: p.thigh, shin: p.shin, fold: KNEE_FLEXION * Math.PI / 180, ankleHeight: p.ankleHeight, rotation: footRotation,
      legs: SIDES.map((side, i) => ({ sign: i === 0 ? 1 : -1, foot: INDEX[`${side}Foot`], toes: INDEX[`${side}Toes`], top: INDEX[`${side}UpperLeg`] })),
      ankle: (i, anchor, yaw, pitch, out) => ankleFor(p, SIDES[i], anchor, yaw, pitch, out),
      lean: (i, pose, yaw) => shankTilt(pose, SIDES[i], yaw),
      print: (i, anchor, yaw) => soles[i].map((point): [number, number] => {
        const at = point.clone().applyQuaternion(footRotation(yaw, 0)).add(anchor);
        return [at.x, at.z];
      }),
      sole: (i, ankle, foot, toes) => {
        const ball = ballOf(p, SIDES[i], _b).applyQuaternion(foot).add(ankle), sign = i === 0 ? 1 : -1;
        return Math.min(heelOf(p, _a).applyQuaternion(foot).y + ankle.y, ...[p.sole.bigToe, p.sole.smallToe].map((tip) => _a.copy(tip).setX(tip.x * sign).applyQuaternion(toes).y + ball.y));
      } };
    const stepper = (h.stepper = new Stepper(record, feet, h.feet, h.yaw));
    const asks = createAsks();
    const trunk = [new TrackedRotation(), new TrackedRotation()], tilts = [0, 0], sways = [0, 0];
    let was: Vector3 | null = null;
    yield* action<Frame>({ update: (f) => {
      if (f.dev && f.time > f.dt) check(h, f, f.dev, stepper.legs);
      takeAsks(h.asks, asks);
      const dt = f.dt, r = rootOf(f, asks, stepper);
      stepper.move(f, r);
      const k = stepper.crouch;
      const { yaw, moving, run, Ts, legs } = stepper;
      // (a body carrying itself otherwise — a walker's posture — places the pelvis and trunk itself, its thorax turned so far)
      const thoraxYaw = carry?.(f, asks, stepper) ?? 0;
      if (!carry) {
        // the pelvis tipped forward with the stride (room for the hip to extend behind), the trunk leaning on it as asked
        // (taken up and given up within an acceleration: a hard start or stop does not jerk the trunk)
        const tilt = follow(tilts[0], tilts[1], lerp(TILT.walk * moving, TILT.run, run), { accel: TILT.accel }, dt);
        [tilts[0], tilts[1]] = [tilts[1], tilt];
        // (turned toward the swinging leg's side as it comes through, the thorax back the other way)
        const turn = -PELVIC_ROTATION * moving * legs.reduce((sum, leg) => sum + (leg.swing ? leg.sign * Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0);
        f.current.setLocal(0, quatYXZ(yaw + turn, tilt, 0, _q));
        // (the pelvis swaying over the stance foot, the root staying where the player has it: only the hips move about it)
        // (a sinusoid of the stride, over the left foot at the right's mid-swing: `phase` 0 as the left lifts, its mid-swing π (1 − stance share) on)
        const sway = follow(sways[0], sways[1], -lerp(SWAY.walk, SWAY.run, run) * p.scale * moving * Math.cos(stepper.phase - Math.PI * (1 - Ts / stepper.cycle)), { accel: SWAY.accel }, dt);
        [sways[0], sways[1]] = [sways[1], sway];
        f.current.setRoot(_v.copy(f.current.position(0)).addScaledVector(leftOf(yaw, _f), sway));
        // (the trunk nods forward as each foot takes the weight, about its landing: continuous as feet lift and land; it leans into
        // speeding up and back from slowing down)
        const nod = lerp(NOD.walk, NOD.run, run) * moving * legs.reduce((sum, leg) => sum + 1 - Math.sin(Math.PI * (leg.swing ? leg.swing.u : Math.min(1, leg.planted / Ts))) ** 2, 0) / 2;
        // (spawned on the move, it starts at that pace: no jolt of the trunk)
        was ??= r.velocity.clone();
        const speeding = _v.subVectors(r.velocity, was).divideScalar(dt).dot(forwardOf(yaw, _f));
        was.copy(r.velocity);
        const lean = stepper.airborne ? 0 : clamp(SPEEDING.share * Math.atan2(speeding, GRAVITY), -SPEEDING.back, SPEEDING.ahead);
        // (the thorax turned back against the pelvis, the shoulder going forward rising with it)
        const thorax = -COUNTER.turn * turn;
        const twist = clamp(asks.twist + thorax - turn, -0.8, 0.8);
        const bend = quatYXZ(twist, asks.bow + RUN_LEAN * run + CROUCH_LEAN * k + lean - tilt + nod, KEEP * sway / p.scale, _bend).slerp(IDENTITY, 0.5);
        const shoulders = quatYXZ(0, 0, COUNTER.roll * thorax, _roll);
        [INDEX.spine, INDEX.chest].forEach((bone, k) => {
          const local = _local.copy(bend), limit = f.current.skeleton.limits[bone];
          if (bone === INDEX.chest) local.multiply(shoulders);
          if (limit) clampRotation(local, limit);
          const followed = trunk[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TRUNK, dt, _q);
          if (limit) clampRotation(followed, limit);
          f.current.setLocal(bone, followed);
        });
      }
      // the legs down to the feet
      legs.forEach((leg, i) => {
        const side = SIDES[i], thigh = f.current.position(INDEX[`${side}UpperLeg`]);
        const pose = stepper.pose(i, thigh);
        // (swinging, the knee goes the way the foot points, but no further off the pelvis's way than `KNEE_OFF`: a foot still turned far
        // out leaves no knee swung out with it — eased in over the swing's first `KNEE_EASE`, not snapped round as it lifts)
        const along = stepper.yaw + leg.sign * record.toeOut, kept = along + clamp(wrapAngle(pose.yaw - along), -KNEE_OFF, KNEE_OFF);
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
          const sunk = -feet.sole(i, f.current.position(INDEX[`${side}Foot`]), f.current.rotation(INDEX[`${side}Foot`]), f.current.rotation(INDEX[`${side}Toes`]));
          if (sunk > 0) place(_lift.copy(pose.ankle).setY(pose.ankle.y + sunk));
        }
        h.feet[i].position.copy(leg.anchor);
        h.feet[i].yaw = leg.yaw;
        h.feet[i].phase = leg.swing ? 'swing' : 'planted';
      });
      const g = h.locomotion, stepping = legs.some((leg) => leg.swing);
      [g.phase, g.walk, g.run, g.facing, g.facingAhead, g.moving, g.thoraxYaw] = [stepper.phase, moving, run, wrapAngle(yaw), wrapAngle(yaw), Math.hypot(r.velocity.x, r.velocity.z) > 0.05 || stepping, thoraxYaw];
      g.velocity.copy(r.velocity).setY(0);
      g.planted = g.moving ? 0 : g.planted + dt;
      g.settled = stepper.settled;
      if (!carry) g.quiet.set(0, 0, 0);
    } });
  };
}

/** Final-pose checks of the last sub-step, against the legs as they were posed then. */
function check(h: Humanoid, f: Frame, dev: Dev, legs: readonly Leg[]) {
  const p = h.proportions, time = f.time - f.dt;
  legs.forEach((leg, i) => {
    const side = SIDES[i], bone = INDEX[`${side}Foot`];
    if (leg.swing) {
      const sink = -Math.min(...solePoints(h, f.prev, side).map((at) => at.y));
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
      if (vertical > LIMIT.vertical && !leg.leapt) dev.append(time, { check: 'driven touchdown vertical speed (m/s)', value: vertical, limit: LIMIT.vertical, where: `${side}Foot` });
      if (horizontal > LIMIT.horizontal) dev.append(time, { check: 'driven touchdown horizontal speed (m/s)', value: horizontal, limit: LIMIT.horizontal, where: `${side}Foot` });
    }
  });
  // (the shanks never closer than their thickness: legs that cross pass through each other)
  const shank = (side: Side) => [f.prev.position(INDEX[`${side}LowerLeg`]), f.prev.position(INDEX[`${side}Foot`])];
  const [l, r] = [shank('left'), shank('right')];
  const gap = Math.min(...[0, 0.25, 0.5, 0.75, 1].flatMap((k) => [
    pointSegmentDistance(new Vector3().lerpVectors(l[0], l[1], k), r[0], r[1]), pointSegmentDistance(new Vector3().lerpVectors(r[0], r[1], k), l[0], l[1])]));
  if (gap < LIMIT.across * p.scale) dev.append(time, { check: 'driven legs crossed (m)', value: LIMIT.across * p.scale - gap, limit: 0, where: 'legs' });
  // Noted only: a driven body follows its input, not its balance.
  const support = legs.flatMap((leg, i) => leg.swing ? [] : solePoints(h, f.prev, SIDES[i]).map((at): [number, number] => [at.x, at.z]));
  if (!support.length) return;
  const xcom = xcomOfPoses(f.prev, f.prev2, f.dt, p.legLength, new Vector3());
  const value = outside(hullOf(support), xcom);
  if (value > LIMIT.xcom) dev.note(time, { check: 'driven XCoM outside support (m)', value, limit: LIMIT.xcom, where: 'hips' });
}

const IDENTITY = new Quaternion(), _roll = new Quaternion(), _q = new Quaternion(), _bend = new Quaternion(), _local = new Quaternion();
const [_a, _b, _pole, _v, _f, _lift] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
