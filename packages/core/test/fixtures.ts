// Test fixtures: random rigs and poses built the way the solver builds them.
import { Euler, Quaternion, Vector3 } from 'three';
import { proportionsFor } from '../src/proportions';
import { CHILD_BONES, PARENT, perBone, type BoneName, type Rest } from '../src/pose/bones';
import { createFrames, type Frames, type Limb } from '../src/pose/frames';
import { createRotations, type Rotations } from '../src/pose/rotations';

/** mulberry32 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return (lo = 0, hi = 1) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return lo + (hi - lo) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}
export type Rand = ReturnType<typeof rng>;

export const sampleRest = (height = 1.75): Rest => proportionsFor(height);

const yxz = (yaw: number, pitch: number, roll: number) => new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));

function twoBone(root: Vector3, target: Vector3, l1: number, l2: number, pole: Vector3, out: Limb) {
  const d = target.clone().sub(root);
  const dist = Math.min(d.length(), 0.999 * (l1 + l2));
  d.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(1 - cosA * cosA);
  out.bend.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  out.root.copy(root);
  out.mid.copy(root).addScaledVector(d, cosA * l1).addScaledVector(out.bend, sinA * l1);
  out.end.copy(root).addScaledVector(d, dist);
}

const sphere = (rand: Rand, r: number) => new Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(r);

/** A random plausible pose: solver frames plus the bone origins the solver would report. */
export function samplePose(rand: Rand, rest: Rest, withHands: boolean): { frames: Frames; joints: Record<BoneName, Vector3> } {
  const o = rest.offsets;
  const j = perBone(() => new Vector3());
  const f = createFrames();
  const yaw = rand(-Math.PI, Math.PI);
  const { trunk: t, head: h } = f;
  t.qHips.copy(yxz(yaw, rand(-0.3, 0.8), rand(-0.2, 0.2)));
  t.qSpine.copy(t.qHips).multiply(yxz(rand(-0.3, 0.3), rand(-0.2, 0.4), rand(-0.2, 0.2)));
  t.qChest.copy(t.qSpine).multiply(yxz(rand(-0.3, 0.3), rand(-0.2, 0.4), rand(-0.2, 0.2)));
  h.qNeck.copy(t.qChest).multiply(yxz(rand(-0.4, 0.4), rand(-0.3, 0.3), 0));
  h.qHead.copy(h.qNeck).multiply(yxz(rand(-0.6, 0.6), rand(-0.5, 0.5), rand(-0.2, 0.2)));
  j.hips.set(rand(-2, 2), rand(0.5, 1), rand(-2, 2));
  j.spine.copy(o.spine).applyQuaternion(t.qHips).add(j.hips);
  j.chest.copy(o.chest).applyQuaternion(t.qSpine).add(j.spine);
  j.neck.copy(o.neck).applyQuaternion(t.qChest).add(j.chest);
  j.head.copy(o.head).applyQuaternion(h.qNeck).add(j.neck);
  t.hips.copy(j.hips);
  t.spine.copy(j.spine);
  t.chest.copy(j.chest);
  t.neck.copy(j.neck);
  h.head.copy(j.head);

  (['left', 'right'] as const).forEach((n, s) => {
    const side = f.sides[s];
    const chest = t.qChest;
    const clavicle = j[`${n}Shoulder`].copy(o[`${n}Shoulder`]).applyQuaternion(chest).add(j.chest);
    side.clavicle.copy(clavicle);
    // shrug / protraction: the upper-arm joint moves on a sphere around the clavicle origin
    const clav = o[`${n}UpperArm`].clone().applyQuaternion(chest).add(sphere(rand, 0.3 * o[`${n}UpperArm`].length()));
    const shoulder = j[`${n}UpperArm`].copy(clav.setLength(o[`${n}UpperArm`].length())).add(clavicle);
    const l1 = o[`${n}LowerArm`].length();
    const l2 = o[`${n}Hand`].length();
    twoBone(shoulder, sphere(rand, rand(0.2, 1.1) * (l1 + l2)).add(shoulder), l1, l2, sphere(rand, 1), side.arm);
    j[`${n}LowerArm`].copy(side.arm.mid);
    j[`${n}Hand`].copy(side.arm.end);
    const hip = j[`${n}UpperLeg`].copy(o[`${n}UpperLeg`]).applyQuaternion(t.qHips).add(j.hips);
    const t1 = o[`${n}LowerLeg`].length();
    const t2 = o[`${n}Foot`].length();
    const ankle = new Vector3(rand(-0.4, 0.4), -rand(0.4, 1), rand(-0.4, 0.5)).multiplyScalar(t1 + t2).add(hip);
    twoBone(hip, ankle, t1, t2, new Vector3(rand(-0.3, 0.3), rand(0, 0.3), 1).applyQuaternion(yxz(yaw, 0, 0)), side.leg);
    j[`${n}LowerLeg`].copy(side.leg.mid);
    j[`${n}Foot`].copy(side.leg.end);
    const footYaw = yaw + rand(-0.4, 0.4);
    const pitch = rand(-0.6, 0.4);
    side.foot.copy(yxz(footYaw, -pitch, 0));
    side.toes.copy(yxz(footYaw, -Math.max(0, pitch), 0));
    j[`${n}Toes`].copy(o[`${n}Toes`]).applyQuaternion(side.foot).add(side.leg.end);
    side.hand = withHands ? { quaternion: new Quaternion().random(), weight: rand() < 0.5 ? 1 : rand() } : null;
  });
  return { frames: f, joints: j };
}

/** Forward kinematics: bone origins in world space from local rotations, the rest offsets and the hips position. */
export function forward(local: Rotations, rest: Rest, hips: Vector3, out: Record<BoneName, Vector3>): Record<BoneName, Vector3> {
  const world = createRotations();
  world.hips.copy(local.hips);
  out.hips.copy(hips);
  for (const b of CHILD_BONES) {
    const p = PARENT[b];
    world[b].multiplyQuaternions(world[p], local[b]);
    out[b].copy(rest.offsets[b]).applyQuaternion(world[p]).add(out[p]);
  }
  return out;
}
