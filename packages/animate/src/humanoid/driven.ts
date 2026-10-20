// A player's body: the core stepper keeps the legs under the root the scene drives; here the trunk, the leg chains and the human checks.
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { solveChain } from '../core/chain';
import { follow } from '../core/follow';
import { live, type Behaviour, type Live } from '../core/goal';
import { clampRotation } from '../core/limits';
import { clamp, forwardOf, GRAVITY, lerp, minimumJerk, pointSegmentDistance, quatYXZ, wrapAngle } from '../core/math';
import { Stepper, type DrivenRoot, type Feet, type Leg } from '../core/legs/stepper';
import { TrackedRotation } from '../core/track';
import { createAsks, takeAsks } from '../core/asks';
import { ankleFor, ballOf, footRotation, heelOf } from './balance/foot';
import { shankTilt } from './balance/legs';
import { hullOf, outside } from './balance/support';
import { INDEX, SIDES, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { solePoints } from './landmarks';
import { humanStepping } from './legs';

/** Tuned: the trunk leaning forward crouched and into a run (rad), following within `TRUNK` (rad/s²); recalled (CMU mocap, as the balance posture has it): it nods ~±1.2° walking, ~±3° running (rad, peak). */
const CROUCH_LEAN = 0.3, RUN_LEAN = 0.12, TRUNK = { accel: 60 }, NOD = { walk: 0.06, run: 0.09 };
/** Recalled: anterior pelvic tilt grows with speed (~5° walking, ~15° running; Novacheck 1998); tuned: changing within `accel` (rad/s²). */
const TILT = { walk: 0.06, run: 0.25, accel: 8 };
/** Development bounds: planted pivot slide (m), touchdown speeds (m/s), closest shanks (m, ~their thickness), logged-only XCoM (m). */
const LIMIT = { slide: 0.001, vertical: 0.1, horizontal: 1, across: 0.06, xcom: 0.1 };

/**
 * Legs under a root the scene drives (`root`, read every sub-step; see `Stepper`): `h.stepper` takes a `jump` and says when
 * it is `airborne`. The pelvis tips forward with the stride; the trunk takes `h.asks.bow` and `twist`, nods as each foot takes
 * the weight; the pelvis' height is the legs' own (`crouch`, a leap): `lower` is not taken.
 * Development checks: planted slide, touchdown speed, feet across; the XCoM is only noted.
 */
export function driven<W>(h: Humanoid<W>, root: Live<DrivenRoot, W>): Behaviour<W> {
  return function* () {
    const p = h.proportions;
    const feet: Feet = { hip: p.hipHalfWidth, length: p.legLength, thigh: p.thigh, shin: p.shin, ankleHeight: p.ankleHeight, rotation: footRotation,
      legs: SIDES.map((side, i) => ({ sign: i === 0 ? 1 : -1, foot: INDEX[`${side}Foot`], toes: INDEX[`${side}Toes`], top: INDEX[`${side}UpperLeg`] })),
      ankle: (i, anchor, yaw, pitch, out) => ankleFor(p, SIDES[i], anchor, yaw, pitch, out),
      lean: (i, pose, yaw) => shankTilt(pose, SIDES[i], yaw),
      sole: (i, ankle, foot, toes) => {
        const ball = ballOf(p, SIDES[i], _b).applyQuaternion(foot).add(ankle), sign = i === 0 ? 1 : -1;
        return Math.min(heelOf(p, _a).applyQuaternion(foot).y + ankle.y, ...[p.sole.bigToe, p.sole.smallToe].map((tip) => _a.copy(tip).setX(tip.x * sign).applyQuaternion(toes).y + ball.y));
      } };
    const stepper = (h.stepper = new Stepper(humanStepping(p), feet, h.feet, h.yaw));
    const asks = createAsks();
    const trunk = [new TrackedRotation(), new TrackedRotation()], tilts = [0, 0];
    yield* action<Frame<W>>({ update: (f) => {
      if (f.dev && f.time > f.dt) check(h, f, stepper.legs);
      const dt = f.dt, r = live(root, f), k = minimumJerk(clamp(r.crouch ?? 0, 0, 1));
      takeAsks(h.asks, asks);
      stepper.move(f, r);
      const { yaw, moving, run, Ts, legs } = stepper;
      // the pelvis tipped forward with the stride (room for the hip to extend behind), the trunk leaning on it as asked
      // (taken up and given up within an acceleration: a hard start or stop does not jerk the trunk)
      const tilt = follow(tilts[0], tilts[1], lerp(TILT.walk * moving, TILT.run, run), { accel: TILT.accel }, dt);
      [tilts[0], tilts[1]] = [tilts[1], tilt];
      f.current.setLocal(0, quatYXZ(yaw, tilt, 0, _q));
      // (the trunk nods forward as each foot takes the weight, about its landing: continuous as feet lift and land)
      const nod = lerp(NOD.walk, NOD.run, run) * moving * legs.reduce((sum, leg) => sum + 1 - Math.sin(Math.PI * (leg.swing ? leg.swing.u : Math.min(1, leg.planted / Ts))) ** 2, 0) / 2;
      const bend = quatYXZ(Math.max(-0.8, Math.min(0.8, asks.twist)), asks.bow + RUN_LEAN * run + CROUCH_LEAN * k - tilt + nod, 0, _bend).slerp(IDENTITY, 0.5);
      [INDEX.spine, INDEX.chest].forEach((bone, k) => {
        const local = _local.copy(bend), limit = f.current.skeleton.limits[bone];
        if (limit) clampRotation(local, limit);
        const followed = trunk[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TRUNK, dt, _q);
        if (limit) clampRotation(followed, limit);
        f.current.setLocal(bone, followed);
      });
      // the legs down to the feet
      legs.forEach((leg, i) => {
        const side = SIDES[i], thigh = f.current.position(INDEX[`${side}UpperLeg`]);
        const pose = stepper.pose(i, thigh);
        const pole = _pole.copy(thigh).add(pose.ankle).multiplyScalar(0.5).addScaledVector(forwardOf(pose.yaw), 0.5);
        // (planted, the leg turns as the foot needs; swinging, the knee bends toward the pole and the foot turns within the ankle's range, so the knee never swivels to suit it)
        solveChain(f, `${side}Leg`, { tip: { position: pose.ankle, quaternion: leg.swing ? undefined : pose.foot }, pole });
        const ankle = _local.copy(f.current.rotation(INDEX[`${side}LowerLeg`])).invert().multiply(pose.foot);
        const ankleRange = f.current.skeleton.limits[INDEX[`${side}Foot`]];
        if (ankleRange) clampRotation(ankle, ankleRange);
        f.current.setLocal(INDEX[`${side}Foot`], ankle);
        // (planted, the toes lie on the floor; swinging, they keep their own bend whatever the ankle's range left of the foot's turn)
        const toes = _local.copy(leg.swing ? pose.foot : f.current.rotation(INDEX[`${side}Foot`])).invert().multiply(pose.toes);
        const range = f.current.skeleton.limits[INDEX[`${side}Toes`]];
        if (range) clampRotation(toes, range);
        f.current.setLocal(INDEX[`${side}Toes`], toes);
        h.feet[i].position.copy(leg.anchor);
        h.feet[i].yaw = leg.yaw;
        h.feet[i].phase = leg.swing ? 'swing' : 'planted';
      });
      const g = h.locomotion, stepping = legs.some((leg) => leg.swing);
      [g.phase, g.walk, g.run, g.facing, g.facingAhead, g.moving, g.thoraxYaw] = [stepper.phase, moving, run, wrapAngle(yaw), wrapAngle(yaw), Math.hypot(r.velocity.x, r.velocity.z) > 0.05 || stepping, 0];
      g.velocity.copy(r.velocity).setY(0);
      g.planted = g.moving ? 0 : g.planted + dt;
      g.settled = stepper.settled;
      g.quiet.set(0, 0, 0);
    } });
  };
}

/** Final-pose checks of the last sub-step, against the legs as they were posed then. */
function check<W>(h: Humanoid<W>, f: Frame<W>, legs: readonly Leg[]) {
  const dev = f.dev!, p = h.proportions, time = f.time - f.dt;
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
  const com = f.prev.com(new Vector3()), velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = com.addScaledVector(velocity, Math.sqrt(p.legLength / GRAVITY));
  const value = outside(hullOf(support), xcom);
  if (value > LIMIT.xcom) dev.note(time, { check: 'driven XCoM outside support (m)', value, limit: LIMIT.xcom, where: 'hips' });
}

const IDENTITY = new Quaternion(), _q = new Quaternion(), _bend = new Quaternion(), _local = new Quaternion();
const [_a, _b, _pole] = [new Vector3(), new Vector3(), new Vector3()];
