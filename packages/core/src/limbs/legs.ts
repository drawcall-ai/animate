import { Quaternion, Vector3 } from 'three';
import type { FootPhase } from '../gait/foot';
import type { Gait } from '../gait/gait';
import { isSphere, type Box, type Sphere } from '../input';
import { clamp, forwardOf, leftOf, quatYXZ, smoothstep, softMin, Spring } from '../math';
import { createLimb, type Side, type TrunkFrame } from '../pose/frames';
import type { Proportions } from '../proportions';
import type { Stance } from '../stance';
import { SIDE_BONES } from '../pose/bones';
import { twistShare } from '../pose/limits';
import { solveInRange, solveTwoBone, type LimbJoints } from './twoBone';

const _v = new Vector3();
const _w = new Vector3();
const _pole = new Vector3();
const _fwd = new Vector3();
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const _arc = new Quaternion();
const _out = new Vector3();

/** The legs: the pelvis height they allow, then knees, feet and toes down to the feet the gait placed. */
export class Legs {
  /** how far the pelvis is lowered so the legs reach their feet (m, ≤ 0) */
  lift = 0;
  private liftSpring = new Spring();
  /** each leg's joints, kept in their ranges */
  private readonly joints: [LimbJoints, LimbJoints];

  constructor(
    private d: Proportions,
    private stance: Stance,
    private tf: TrunkFrame,
    private gait: Gait,
  ) {
    const share = twistShare('leftLowerLeg', 'leftFoot');
    const joints = (s: number): LimbJoints => {
      const b = SIDE_BONES[s];
      return { limb: createLimb(), len1: d.thigh, len2: d.shin, maxExtension: 0.9995, softness: 0.012, upper: b.upperLeg, lower: b.lowerLeg, end: b.foot, upperRest: d.offsets[b.lowerLeg], lowerRest: d.offsets[b.foot], share, parent: tf.qHips, turn: new Quaternion(), weight: 1, swivel: 0 };
    };
    this.joints = [joints(0), joints(1)];
  }

  /**
   * Pelvis height: legs must reach their feet (heel-off allowed for trailing feet). Each
   * foot's constraint fades in and out continuously — the landing foot during late swing,
   * the lifting foot during early swing — so contacts don't pop the pelvis.
   */
  updateLift(drop: number, dt: number) {
    const { d, tf, gait: g } = this;
    const fwd = forwardOf(g.root.yaw, _fwd);
    const reach = 0.9998 * d.legLength;
    // (pushing off into a jump the heels come up too)
    const tiptoe = (drop < -0.005 && g.walk < 0.2) || g.jump.phase === 'push' || g.move.heel > 0;
    let limit = Infinity;
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const hip = tf.upperLegs[s];
      if (f.phase === 'planted') {
        const behind = -((f.anchor.x - hip.x) * fwd.x + (f.anchor.z - hip.z) * fwd.z);
        const maxHeelOff = behind > 0.05 || tiptoe ? -0.75 : f.landPitch * (1 - smoothstep(0, 0.15, f.plantedTime));
        limit = Math.min(limit, maxHipHeight(hip, f.ankleFor(f.anchor, f.yaw, maxHeelOff, _v), reach));
      } else if (f.phase === 'swing' && f.swing.s > 0.5 && !g.jump.airborne && !g.move.owns) {
        // a lifted foot no longer holds the pelvis down (the body vaults up over the
        // stance leg; the spring smooths the release); the landing foot's constraint
        // fades in during late swing
        const relax = 0.4 * d.height;
        const w = f.swing;
        limit = Math.min(limit, maxHipHeight(hip, f.ankleFor(w.to, w.toYaw, w.strikePitch, _v), reach) + relax * (1 - smoothstep(0.5, 1, w.s)));
      }
    }
    let lift = 0;
    if (limit < Infinity) {
      const hipY = tf.upperLegs[0].y * 0.5 + tf.upperLegs[1].y * 0.5;
      const allowed = softMin(hipY, limit, 0.01);
      // never collapse: a leg that still cannot reach is resolved by the step logic
      lift = clamp(allowed - hipY, -0.03 * d.height, 0);
    }
    this.lift = dt > 0 ? this.liftSpring.step(lift, 25, dt) : lift;
  }

  /** `bodyObstacles`: the knees swing around the spheres; over `dt` (s) */
  solve(bodyObstacles: readonly (Sphere | Box)[], sides: readonly [Side, Side], dt: number) {
    const { d, tf, gait: g } = this;
    const bodyFwd = forwardOf(g.root.yaw + this.stance.blade, _fwd);
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const { ankle, quaternion, toePitch } = f.pose;
      const side = sides[s];
      const hip = tf.upperLegs[s];
      kneePole(f, bodyFwd, hip, ankle, _pole);
      const j = this.joints[s];
      j.limb = side.leg;
      j.limb.root.copy(hip);
      j.turn.copy(quaternion);
      solveInRange(j, ankle, _pole, dt);
      const leg = j.limb;
      // a knee inside a body obstacle swings sideways around it (knees splay around a box)
      const kneeR = 0.035 * d.height;
      for (const a of bodyObstacles) {
        if (!isSphere(a) || leg.mid.distanceTo(a.center) >= a.radius + kneeR) continue;
        const out = leftOf(g.root.yaw, _w).multiplyScalar(f.side);
        for (let k = 1; k <= 6 && leg.mid.distanceTo(a.center) < a.radius + kneeR; k++) {
          _pole.addScaledVector(out, 0.35).normalize();
          solveTwoBone(leg, ankle, d.thigh, d.shin, _pole, 0.9995, 0.012);
        }
      }
      side.foot.copy(quaternion);
      quatYXZ(f.yaw, -toePitch, 0, side.toes);
    }
  }
}

/**
 * Where foot `f`'s knee bends (into `out`): over the toes (blended with the body heading for
 * robustness; turned out by its `kneeOut`); a leg raised forward (kick, high step) bends with
 * the knee up, never flipping; one raised out sideways carries it along, the knee staying at the
 * thigh's front, untwisted at the hip (astride a mount, the thighs grip it: the knee stays ahead).
 */
export function kneePole(f: { yaw: number; side: number; kneeOut: number; phase: FootPhase }, bodyFwd: Vector3, hip: Vector3, ankle: Vector3, out: Vector3): Vector3 {
  forwardOf(f.yaw, out).add(bodyFwd).normalize();
  if (f.kneeOut) out.applyAxisAngle(UP, f.side * f.kneeOut);
  const leg = _w.subVectors(ankle, hip).normalize();
  const outward = _out.crossVectors(UP, out).multiplyScalar(f.side);
  const abducted = f.phase === 'carried' ? 0 : Math.max(0, leg.dot(outward));
  out.y = 0.15 + 2.5 * Math.max(0, leg.dot(out) + 0.2);
  return out.applyQuaternion(_arc.setFromUnitVectors(DOWN, _v.set(0, -Math.sqrt(1 - abducted * abducted), 0).addScaledVector(outward, abducted)));
}

/** the highest the hip joint (at `hip`'s x, z) can be with the leg (`reach` long) still reaching `ankle` */
function maxHipHeight(hip: Vector3, ankle: Vector3, reach: number): number {
  const h2 = reach * reach - ((hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2);
  return ankle.y + Math.sqrt(Math.max(1e-4, h2));
}
