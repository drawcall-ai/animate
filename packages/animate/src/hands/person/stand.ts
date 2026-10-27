import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import type { Goal } from '../../kernel/goal';
import { loadFactor } from '../../kernel/load';
import { forwardOf, headingOf, leftOf, pointSegmentDistance, wrapAngle } from '../../kernel/math';
import { Walk } from '../../legs/walk';
import { during, type Request } from '../../kernel/requests';
import { ARM_REACH } from './bend';
import { INDEX, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { floorUnder } from '../../legs/person/legged';
import { bowLever, lowering, MOST_BOW, squatOf, TIPTOE } from '../../legs/person/posture';
import { defaultStance } from '../../species/humanoid/stance';

/** Comfortable stand distance as a share of arm length. */
const WITHIN = 0.8;
/** Tuned: the stand distance for two hands low down (× the arm's length), leaving room to bend */
const LOW_STAND = 1.05;
/** in reach without a step: each grip this near its shoulder on the floor's plane (× the arm's length: lower down, the body bows for it),
 * the body facing within SQUARE (rad) of the way asked for two */
const IN_REACH = 0.65, SQUARE = 0.3;
/** arrived where it stands to take something: this near (m, default body), and come to rest or stood still this long (s) */
const ARRIVED = 0.12;
/** how far round what it takes the body walks when the way passes it (m, default body): past a stand's foot */
const ROUND = 0.5;
// Tuned progress around a support before the final leg (share of ROUND).
const ON = 0.5;
// Tuned frontal approach cone: lateral offset at most half the forward distance to the target.
const ROUND_ASIDE = 0.5;
// Proxy radius for other bodies’ low segments, not measured (m).
const SEGMENT_RADIUS = 0.06;
/** Tuned: both hands low down, how far (× the arm's length) beyond its toes the grips' middle is as it stands to take them, or to set down what they hold */
const LOW_AHEAD = 0.3, LOW_SETTING = 0.2;
/** Tuned: a placing point lower than this share of the arm's reach below the shoulders, the body lowers and bows for */
const LOWERED_BELOW = 0.7;

/** What a person stands to: grips to take (by the hand that takes each, where each is now, the heaviest load's mass), or a placing point. */
type Stand =
  | { grips: readonly { side: Side; at: Vector3 }[]; mass: number }
  | { place: (f: Frame) => Goal; held: readonly { side: Side; at: Vector3 }[] };

/** A walk to where a person stands, and when it has arrived there. */
export interface WalkUp {
  walk: Walk;
  arrived: (f: Frame) => boolean;
}

/** Where a person stands to take or put something: there already, nowhere it could, or a walk there. */
type Footing = 'there' | 'nowhere' | WalkUp;

/** Test reach from standing shoulder height, including free-hand trunk rotation. */
export function armReaches(person: Reacher, at: Readonly<Vector3>, side: Side | undefined, free: boolean): boolean {
  const proportions = person.proportions, shoulder = shoulderOf(person, side).setY(floorUnder(person) + proportions.shoulderHeight);
  return shoulder.distanceTo(at) < ARM_REACH * proportions.armLength + (free ? proportions.shoulderHalfWidth : 0);
}

function shoulderOf(person: Reacher, side?: Side): Vector3 {
  return side
    ? person.pose.position(INDEX[`${side}UpperArm`]).clone()
    : person.pose.position(INDEX.leftUpperArm).clone().add(person.pose.position(INDEX.rightUpperArm)).multiplyScalar(0.5);
}

/** Find a comfortable stand clear of bodies and support, or report that no reachable stand exists. */
export function footing(person: Reacher, to: Stand): Footing {
  const f0 = person.frame, point = 'place' in to;
  const start = point ? to.place(f0) : null;
  if (start?.carriedBy === person) return 'there';
  const grips: { side?: Side; at: Vector3 }[] = [];
  if (!point) grips.push(...to.grips.map((grip) => ({ side: grip.side, at: grip.at.clone() })));
  else if (start) {
    const quaternion = start.quaternion;
    if (quaternion) for (const { side, at } of to.held) grips.push({ side, at: at.clone().applyQuaternion(quaternion).add(start.position) });
    if (!grips.length) grips.push({ at: start.position.clone() });
  }
  let face = facingFor(person, grips);
  const proportions = person.proportions;
  const height = grips.reduce((sum, grip) => sum + grip.at.y, 0) / grips.length;
  const standing = floorUnder(person) + proportions.shoulderHeight;
  const reach = ARM_REACH * proportions.armLength;
  const { drop, forward } = point ? stoop(proportions, Math.max(0, standing - height - LOWERED_BELOW * reach)) : { drop: 0, forward: 0 };
  const shoulders = standing - drop + (point ? Math.min(TIPTOE * proportions.scale, Math.max(0, height - standing)) : 0);
  const available = point ? Math.sqrt(Math.max(0, reach ** 2 - (height - shoulders) ** 2)) + forward : Infinity;
  // Tuned: bring heavier low grips closer as the load strategy caps trunk bow.
  const distance = !point && grips.length === 2 && height < proportions.hipHeight ? LOW_STAND / Math.sqrt(loadFactor('mass' in to ? to.mass : 0)) : WITHIN;
  const low = grips.length === 2 && height < proportions.hipHeight - proportions.thigh / 2;
  const beyond = Math.max(0, height - proportions.ankleHeight), up = low ? Math.min(beyond, (point ? LOW_SETTING : LOW_AHEAD) * proportions.armLength) : beyond;
  let ahead = Math.min(distance * proportions.armLength, available, proportions.toeFront + up);
  const middle = grips.reduce((sum, grip) => sum.add(grip.at), new Vector3()).divideScalar(grips.length);
  const nowhere = (check: string, value: number, limit = reach) => {
    f0.dev?.append(f0.time, { check, value, limit, where: `${grips.length} grips` });
    return 'nowhere' as const;
  };
  if (point && Math.abs(height - shoulders) > reach) return nowhere(`approach: placing point from the shoulders' middle, lowered and bowed (m)`, Math.abs(height - shoulders));
  const above = point ? 0 : Math.max(...grips.map((grip) => grip.at.y)) - (standing + TIPTOE * proportions.scale);
  if (above > reach) return nowhere('approach: grip above the shoulders on tiptoe (m)', above);
  if (person.drive) return 'there';
  const at = middle.clone(), there = new Vector3();
  // (the feet stand as far out as the stance has them, or the hips: a foot, not the root, keeps clear of another body's legs)
  const feetOut = Math.max(proportions.hipHalfWidth, defaultStance(proportions).width);
  const clear = () => [...person.near].every((other) => {
    const pose = other.posesFor(person)[0];
    return pose.skeleton.bones.every((bone, b) => {
      if (!b) return true;
      const a = pose.position(bone.parent), end = pose.position(b);
      // Low segments, including any crouched trunk, bound the space occupied near the feet.
      return Math.min(a.y, end.y) > proportions.hipHeight || pointSegmentDistance(there, a, end) >= feetOut + proportions.toeFront + SEGMENT_RADIUS;
    });
  });
  // If a single hand's comfortable stand crowds another body, use its remaining reach before giving up.
  let clearYaw: number | undefined;
  const reserve = stoop(proportions, Math.max(0, standing - height));
  const extended = Math.sqrt(Math.max(0, reach ** 2 - (height - standing + reserve.drop) ** 2)) + reserve.forward;
  const distances = grips.length === 1 ? [ahead, Math.max(ahead, extended)] : [ahead];
  for (const distance of distances) {
    ahead = distance;
    for (let i = 0; i <= 32 && clearYaw === undefined; i++) {
      const yaw = face + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 16;
      there.copy(at).addScaledVector(forwardOf(yaw), -ahead);
      if (clear()) clearYaw = yaw;
    }
    if (clearYaw !== undefined) break;
  }
  if (clearYaw === undefined) return nowhere('approach: no stand clear of nearby low segments', 1, 0);
  face = clearYaw;
  const turned = (yaw = face) => Math.abs(wrapAngle(yaw - person.locomotion.facing)) < SQUARE;
  const near = flat(person.pose.com(_com), middle) < ahead + ARRIVED * proportions.scale;
  if (near && (grips.length === 1 || turned()) && grips.every(({ side, at }) => flat(shoulderOf(person, side), at) < IN_REACH * proportions.armLength)) return 'there';
  if (point && grips.every(({ side, at }) => armReaches(person, at, side, false))) return 'there';
  if (turned() && flat(person.pose.com(_com), there) < ARRIVED * proportions.scale) return 'there';
  const rotation = (f: Frame) => {
    const current = point ? to.place(f) : null;
    return start?.quaternion && current?.quaternion ? current.quaternion.clone().multiply(start.quaternion.clone().invert()) : new Quaternion();
  };
  const facing = (f: Frame) => {
    const ahead = forwardOf(face).applyQuaternion(rotation(f));
    return headingOf(ahead.x, ahead.z);
  };
  const moved = (spot: Vector3, f: Frame) => point && start ? spot.clone().sub(start.position).applyQuaternion(rotation(f)).add(to.place(f).position) : spot;
  const destination = (f: Frame) => moved(at, f);
  const body = person.pose.com(new Vector3()).setY(0);
  const way = there.clone().sub(body).setY(0);
  const length = way.length();
  const along = length > 0 ? middle.clone().sub(body).setY(0).dot(way) / length : 0;
  const nearest = body.clone().addScaledVector(way, along / Math.max(length, Number.EPSILON));
  const offset = body.clone().sub(there);
  const lateral = offset.dot(leftOf(face));
  const frontal = Math.abs(offset.dot(forwardOf(face)));
  // A rigid two-hand destination fixes the load's facing; otherwise route round support anywhere along the straight approach,
  // including within ROUND of the destination.
  const entry = point && grips.length > 1 && Math.abs(lateral) > Math.max(ROUND * proportions.scale, ROUND_ASIDE * frontal);
  const blocked = along > 0 && along < length && flat(nearest, middle) < ROUND * proportions.scale;
  const via: ((f: Frame) => Vector3)[] = [];
  if (entry || blocked) {
    const yaw = entry ? face : headingOf(way.x, way.z);
    const anchor = entry ? there : middle.clone().addScaledVector(way, ON * ROUND * proportions.scale / length);
    const side = Math.sign(body.clone().sub(anchor).dot(leftOf(yaw))) || 1;
    const beside = anchor.clone().addScaledVector(leftOf(yaw), side * ROUND * proportions.scale);
    via.push((f) => moved(beside, f));
  }
  const walk = new Walk(person, { to: destination, face: facing, within: ahead, via });
  return {
    walk,
    arrived: (f) => {
      const spot = destination(f).clone().addScaledVector(forwardOf(facing(f)), -ahead);
      return turned(facing(f)) && flat(f.prev.com(_com), spot) < ARRIVED * proportions.scale && !person.locomotion.moving && (person.stepper?.legs.some((leg) => !leg.swing) ?? true);
    },
  };
}

/** a person's walk to where it stands (borrowed legs) until it has arrived, `true`, or stalled, `false`; what it moves arriving `after` s later */
export function* walking(request: Request, plan: WalkUp, after?: number) {
  const { walk, arrived } = plan;
  yield* during(request, 'go', 'borrowed', (f) => {
    const go = walk.step(f);
    if (after !== undefined) request.eta = walk.eta + after;
    return go;
  }, (f, _, time) => time > 0 && (walk.stalled || arrived(f)));
  return !walk.stalled;
}

/** how far (m) the shoulders come down, and on, lowered and bowed for `want` (m) down: as far as a squat and the deepest bow let them */
function stoop(proportions: Reacher['proportions'], want: number): { drop: number; forward: number } {
  const lever = bowLever(proportions, proportions.shoulderHeight), most = squatOf(proportions) + lever * (1 - Math.cos(MOST_BOW));
  const drop = Math.min(want, most), { bow } = lowering(proportions, { drop, ahead: 0, height: proportions.shoulderHeight });
  return { drop, forward: lever * Math.sin(bow) };
}

/** the facing to take grips `grips` with: the left hand's to the left of the right's, or toward a single one from where the body stands */
function facingFor(person: Reacher, grips: { side?: Side; at: Vector3 }[]): number {
  const left = grips.find((grip) => grip.side === 'left');
  const right = grips.find((grip) => grip.side === 'right');
  if (left && right) return Math.atan2(-(left.at.z - right.at.z), left.at.x - right.at.x);
  const at = grips[0].at;
  const body = person.pose.com(_com);
  return headingOf(at.x - body.x, at.z - body.z);
}

/** the distance between `a` and `b` on the floor's plane */
export const flat = (a: Readonly<Vector3>, b: Readonly<Vector3>) => Math.hypot(a.x - b.x, a.z - b.z);

const _com = new Vector3();
