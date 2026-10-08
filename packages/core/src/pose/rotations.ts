import { Matrix4, Quaternion, Vector3 } from 'three';
import { CHILD_BONES, PARENT, REST_HINGE, SIDE_BONES, perBone, type BoneName, type LimbBone, type Rest } from './bones';
import type { Frames, Limb } from './frames';
import { hypot } from '../math';
import { twistShare } from './limits';

/** one quaternion per bone; world frames or parent-relative, depending on use */
export type Rotations = Record<BoneName, Quaternion>;

export const createRotations = (): Rotations => perBone(() => new Quaternion());

const _d = new Vector3();
const _h = new Vector3();
const _r = new Vector3();
const _r2 = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

/**
 * World rotation of a bone that points along unit `dir` and flexes about `hinge`,
 * given its rest direction and rest hinge: the rotation taking the rest basis
 * (restDir, restHinge, restDir × restHinge) onto (dir, hinge, dir × hinge).
 * The hinges are re-orthogonalised against their directions.
 */
export function hingeFrame(dir: Vector3, hinge: Vector3, restDir: Vector3, restHinge: Vector3, out: Quaternion): Quaternion {
  basis(restDir, restHinge, _q).invert();
  return basis(dir, hinge, out).multiply(_q);
}

function basis(dir: Vector3, hinge: Vector3, out: Quaternion): Quaternion {
  const d = _r.copy(dir).normalize();
  const h = _r2.copy(hinge).addScaledVector(d, -hinge.dot(d)).normalize();
  const t = _d.crossVectors(d, h);
  return out.setFromRotationMatrix(_m.makeBasis(d, h, t));
}

/** `parent` swung (no twist) so that `restDir`, given in the parent's frame, points along world `dir`. */
export function swingFrame(parent: Quaternion, restDir: Vector3, dir: Vector3, out: Quaternion): Quaternion {
  const from = _r.copy(restDir).applyQuaternion(parent).normalize();
  const to = _r2.copy(dir).normalize();
  return out.setFromUnitVectors(from, to).multiply(parent);
}

/** World rotations of every bone from the posed frames. */
function worldFrames(src: Frames, rest: Rest, out: Rotations): Rotations {
  const { trunk, head } = src;
  out.hips.copy(trunk.qHips);
  out.spine.copy(trunk.qSpine);
  out.chest.copy(trunk.qChest);
  out.neck.copy(head.qNeck);
  out.head.copy(head.qHead);
  const o = rest.offsets;
  for (let s = 0; s < 2; s++) {
    const b = SIDE_BONES[s];
    const side = src.sides[s];
    swingFrame(out.chest, o[b.upperArm], _h.subVectors(side.arm.root, side.clavicle), out[b.shoulder]);
    limbFrames(side.arm, b.upperArm, b.lowerArm, o[b.lowerArm], o[b.hand], out);
    out[b.hand].copy(out[b.lowerArm]);
    if (side.hand) out[b.hand].slerp(side.hand.quaternion, side.hand.weight);
    limbFrames(side.leg, b.upperLeg, b.lowerLeg, o[b.lowerLeg], o[b.foot], out);
    out[b.foot].copy(side.foot);
    out[b.toes].copy(side.toes);
  }
  return out;
}

const _hinge = new Vector3();
function limbFrames(limb: Limb, upper: LimbBone, lower: LimbBone, upperRest: Vector3, lowerRest: Vector3, out: Rotations) {
  const hinge = _hinge.subVectors(limb.end, limb.root).cross(limb.bend).normalize();
  hingeFrame(_h.subVectors(limb.mid, limb.root).normalize(), hinge, upperRest, REST_HINGE[upper], out[upper]);
  hingeFrame(_h.subVectors(limb.end, limb.mid).normalize(), hinge, lowerRest, REST_HINGE[lower], out[lower]);
}

/** Parent-relative rotations from world frames; the hips stay in world space. */
function toLocal(world: Rotations, out: Rotations): Rotations {
  out.hips.copy(world.hips);
  for (const b of CHILD_BONES) out[b].copy(world[PARENT[b]]).invert().multiply(world[b]);
  return out;
}

/**
 * The pose's parent-relative rotations from the posed frames (`world` receives the
 * world rotations). A turned hand or foot passes its share of its twist on to the forearm or
 * shank (`splitTwist`).
 */
export function fromFrames(src: Frames, rest: Rest, world: Rotations, out: Rotations): Rotations {
  toLocal(worldFrames(src, rest, world), out);
  for (let s = 0; s < 2; s++) {
    const b = SIDE_BONES[s];
    if (src.sides[s].hand) splitTwist(out[b.lowerArm], out[b.hand], rest.offsets[b.hand], ARM_SHARE);
    splitTwist(out[b.lowerLeg], out[b.foot], rest.offsets[b.foot], LEG_SHARE);
  }
  return out;
}

/** the forearm's and the shank's shares of the twist below them: their twist's ranges over the limb's (limits.ts) */
const ARM_SHARE = twistShare('leftLowerArm', 'leftHand');
const LEG_SHARE = twistShare('leftLowerLeg', 'leftFoot');

/**
 * Moves `share` of the end's twist about the lower bone's axis onto the lower bone (local
 * rotations): a forearm's pronation turns the radius along it, not the wrist alone (the twist
 * or roll bones of game rigs), a shank's tibial rotation turns the foot with the ankle's own.
 * The end's world rotation and every joint position stay unchanged. `axis` = the lower bone's
 * direction in its own frame (the end's rest offset).
 */
export function splitTwist(lower: Quaternion, end: Quaternion, axis: Vector3, share: number) {
  const a = _r.copy(axis).normalize();
  const k = end.x * a.x + end.y * a.y + end.z * a.z;
  // the twist about a: (a·(a·v), w), normalized; its share by the angle
  const s = end.w < 0 ? -1 : 1;
  const len = hypot(k, end.w);
  if (len < 1e-9) return;
  const t = share * 2 * Math.atan2(s * k, s * end.w);
  const sn = Math.sin(t / 2);
  const part = _q.set(sn * a.x, sn * a.y, sn * a.z, Math.cos(t / 2));
  lower.multiply(part);
  end.premultiply(part.invert());
}
