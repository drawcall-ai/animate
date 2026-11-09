// A person's leg: as the legs read it, and posed down to the foot the stepper plans.
import { Quaternion, Vector3 } from 'three';
import { solveChain } from '../../kernel/chain';
import type { Frame } from '../../kernel/frame';
import { clampRotation } from '../../kernel/limits';
import { clamp, forwardOf, minimumJerk, wrapAngle, yawOf } from '../../kernel/math';
import type { ReadonlyBonePose } from '../../kernel/bone-pose';
import type { Stepper } from '../../step/stepper';
import type { Leg } from '../../step/steps';
import { INDEX, SIDES, type Side } from '../anatomy/bones';

/**
 * Tuned within the hip's ~35–45° of turn (recalled: AAOS ranges): a swinging knee points at most this far (rad) off the pelvis's facing
 * (with its toe-out); tuned: eased in over this share of the swing
 */
const KNEE_OFF = 0.35, KNEE_EASE = 0.3;
/** Tuned: a swinging foot more than this (rad) off its planned turn about the vertical, as its knee leaves it, is twisted the rest of the way */
const TWISTED = 0.02;

/** a leg's chain */
export const legOf = (side: Side) => (side === 'left' ? 'leftLeg' : 'rightLeg');

/** the shank's forward tilt over a foot heading `yaw` as `pose` has the leg (rad, + the knee ahead of the ankle) */
export function shankTilt(pose: ReadonlyBonePose, side: Side, yaw: number): number {
  const shin = _v.subVectors(pose.position(INDEX[`${side}LowerLeg`]), pose.position(INDEX[`${side}Foot`]));
  return Math.atan2(shin.x * Math.sin(yaw) + shin.z * Math.cos(yaw), shin.y);
}

/**
 * Where a leg's knee bends (a direction, into `out`): over the toes (the foot's heading `yaw`
 * blended with the body's `facing`); a leg raised forward bends with the knee up, one raised out
 * sideways carries it along.
 */
export function kneePole(side: Side, yaw: number, facing: number, hip: Vector3, ankle: Vector3, out: Vector3): Vector3 {
  // (halfway round from the facing to the foot's heading: a sum of the two would vanish for a foot turned far round)
  forwardOf(facing + 0.5 * wrapAngle(yaw - facing), out);
  const leg = _leg.subVectors(ankle, hip).normalize();
  const outward = _out.crossVectors(UP, out).multiplyScalar(side === 'left' ? 1 : -1);
  const abducted = Math.max(0, leg.dot(outward));
  out.y = 0.15 + 2.5 * Math.max(0, leg.dot(out) + 0.2);
  return out.applyQuaternion(_arc.setFromUnitVectors(DOWN, _v.set(0, -Math.sqrt(1 - abducted * abducted), 0).addScaledVector(outward, abducted))).normalize();
}

/** A leg posed down to the foot the stepper plans. */
export function poseLeg(f: Frame, stepper: Stepper, leg: Leg, i: number): void {
  const { feet, st } = stepper;
  const side = SIDES[i], thigh = f.current.position(INDEX[`${side}UpperLeg`]);
  const pose = stepper.pose(i, thigh);
  // (swinging, the knee goes the way the foot points, but no further off the pelvis's way than `KNEE_OFF`: a foot still turned far
  // out leaves no knee swung out with it — eased in over the swing's first `KNEE_EASE`, not snapped round as it lifts)
  const along = stepper.yaw + leg.sign * st.toeOut, kept = along + clamp(wrapAngle(pose.yaw - along), -KNEE_OFF, KNEE_OFF);
  const yawed = leg.swing ? pose.yaw + wrapAngle(kept - pose.yaw) * minimumJerk(leg.swing.u / KNEE_EASE) : pose.yaw;
  const pole = kneePole(side, yawed, along, thigh, pose.ankle, _pole).multiplyScalar(feet.thigh).add(thigh);
  // Hip limits may move the knee off its pole; fitting the ankle's rotation must not choose a different knee plane.
  const place = (at: Vector3) => {
    const shank = INDEX[`${side}LowerLeg`], ankleRange = f.current.skeleton.limits[INDEX[`${side}Foot`]];
    // (the ankle turning the foot as planned under the shank as it is now, within its range (into `_local`; unclamped, `_unclamped`))
    const ankled = () => {
      _unclamped.copy(f.current.rotation(shank)).invert().multiply(pose.foot);
      _local.copy(_unclamped);
      if (ankleRange) clampRotation(_local, ankleRange);
      return _local;
    };
    solveChain(f, `${side}Leg`, { tip: { position: at, quaternion: leg.swing ? undefined : pose.foot }, pole, poleFirst: true });
    // (swinging, a foot turned further about the vertical than the ankle's range leaves it, off the way its knee points, is turned
    // there by the knee's own twist — the tibia rotates in its flexion — as far as the knee's range lets: left turned with the knee, a
    // foot turning about on a tread swept its toes 16° off its way into the riser it was planned clear of)
    let twist: number | undefined;
    if (leg.swing) {
      const off = wrapAngle(yawOf(pose.foot) - yawOf(_solved.copy(f.current.rotation(shank)).multiply(ankled())));
      if (Math.abs(off) > TWISTED) {
        twist = (off - Math.sign(off) * TWISTED) * _axis.copy(f.current.skeleton.bones[INDEX[`${side}Foot`]].offset).normalize().applyQuaternion(f.current.rotation(shank)).y;
        solveChain(f, `${side}Leg`, { tip: { position: at }, pole, twist });
      }
    }
    const ankle = ankled().clone();
    // Prepare the planted orientation during terminal swing instead of changing the chain's constraints at contact.
    if (leg.swing && leg.swing.u > 0.5 && ankle.angleTo(_unclamped) > 1e-6) {
      const landing = f.current.rotation(shank).clone().multiply(ankle).slerp(pose.foot, minimumJerk((leg.swing.u - 0.5) / 0.5));
      solveChain(f, `${side}Leg`, { tip: { position: at, quaternion: landing }, pole, twist: twist ?? 0, poleFirst: true });
      ankle.copy(f.current.rotation(shank)).invert().multiply(landing);
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
  // (a swinging foot the ankle's range turned off its plan — toes down past it, behind a crouch — lifted as far as that put it into the
  // floor, again as the lift turns the shank and the ankle's range with it)
  for (let pass = 0, lift = 0; leg.swing && pass < 4; pass++) {
    const sunk = -stepper.above(feet.soles(i, f.current.position(INDEX[`${side}Foot`]), f.current.rotation(INDEX[`${side}Foot`]), f.current.rotation(INDEX[`${side}Toes`])));
    if (sunk <= 0) break;
    place(_lift.copy(pose.ankle).setY(pose.ankle.y + (lift += sunk)));
  }
}

const _local = new Quaternion(), _solved = new Quaternion(), _unclamped = new Quaternion(), _axis = new Vector3(), _pole = new Vector3(), _lift = new Vector3();
const UP = new Vector3(0, 1, 0), DOWN = new Vector3(0, -1, 0), _leg = new Vector3(), _out = new Vector3(), _arc = new Quaternion(), _v = new Vector3();
