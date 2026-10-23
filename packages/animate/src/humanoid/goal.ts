import { Quaternion, Vector3 } from 'three';
import type { Body, Frame } from '../core/body';
import { movingPoint, type Placement } from '../core/goal';
import { loadFactor } from '../core/load';
import { heldMass } from '../core/worn';
import { Humanoid } from './humanoid';
import { sideOf, type Side } from './bones';
import { rests } from '../core/hands';
import { BODY_RADIUS, LOAD_RESERVE } from './hands/clearance';
import { ARM_REACH, PROTRACTION } from './arms';
import { gripOf, type Item } from '../core/carrier';
import { SIDES } from './bones';


/** A comfortable carry in front of the hips, or beside one hip for a single hand; follows the body. */
export function carried(h: Humanoid, side?: Side): (f: Frame) => Required<Placement> & { velocity: Vector3 };
export function carried<H extends string>(body: Body<H>, hand?: H): (f: Frame) => Required<Placement> & { velocity: Vector3 };
export function carried(body: Body, hand?: string): (f: Frame) => Required<Placement> & { velocity: Vector3 } {
  // (another body's: where its hand rests)
  if (!(body instanceof Humanoid)) {
    const rest = rests(body, hand ?? Object.keys(body.hands)[0]), velocity = new Vector3();
    let last: { time: number; position: Vector3 } | null = null;
    // (moving as the body carries it: a goal on the move is followed, not lagged behind)
    return (f) => {
      const at = rest(f);
      if (last && Math.abs(f.time - f.dt - last.time) < 1e-9) velocity.subVectors(at.position, last.position).divideScalar(f.dt);
      else if (!last || last.time !== f.time) velocity.set(0, 0, 0);
      if (!last || last.time !== f.time) last = { time: f.time, position: at.position.clone() };
      return { ...at, velocity: velocity.clone() };
    };
  }
  return personCarried(body, hand === undefined ? undefined : sideOf(hand));
}

function personCarried(h: Humanoid, side?: Side) {
  const at = movingPoint(h, 0, () => {
    // Recalled load law: shorten the lever arm with squared pace effort (35 → 19 cm at 8 kg).
    const effort = loadFactor(heldMass(h));
    return { position: new Vector3(side ? (side === 'left' ? CARRY_ASIDE : -CARRY_ASIDE) : 0, 0,
      side ? CARRY_BESIDE : CARRY_AHEAD / effort ** 2) };
  }, () => new Quaternion().setFromAxisAngle(UP, h.locomotion.facing));
  return (f: Frame) => {
    const goal = at(f);
    // A lift rises out of its squat: its resting height follows the floor under the feet (their ankles less the ankle's height), not
    // the lowered pelvis.
    const p = h.proportions, item = (side ? h.holding[side] : h.holding.left ?? h.holding.right)?.item;
    const above = Math.max(CARRY_HEIGHT * h.scale, item ? inReach(h, item) : -Infinity);
    goal.position.y = (h.feet[0].position.y + h.feet[1].position.y) / 2 - p.ankleHeight + p.hipHeight + above;
    goal.velocity.y = 0;
    return goal;
  };
}

/**
 * How high above the hips a load carried before the body goes at least (m) for every grip a hand holds to be in the arm's reach
 * (held out, `ARM_REACH`, the clavicle drawn forward, `PROTRACTION`) of its shoulder standing: its back clear of the trunk (as
 * `clearBody` puts it), a grip that far out is reached from that far below the shoulder at most — a bulky load for short arms is held
 * higher, nearer the chest.
 */
function inReach(h: Humanoid, item: Item): number {
  const p = h.proportions, o = p.offsets, reach = ARM_REACH * p.armLength + PROTRACTION * p.height;
  const ahead = BODY_RADIUS * p.height + LOAD_RESERVE * h.scale - item.bounds.min.z;
  return Math.max(-Infinity, ...SIDES.map((side) => {
    const held = h.holding[side];
    if (held?.item !== item) return -Infinity;
    const grip = gripOf(item, held.grip).position;
    const shoulder = o[`${side}Shoulder`].clone().add(o[`${side}UpperArm`]);
    const across = Math.hypot(grip.x - shoulder.x, ahead + grip.z - o.spine.z - o.chest.z - shoulder.z);
    return p.shoulderHeight - p.hipHeight - Math.sqrt(Math.max(0, reach ** 2 - across ** 2)) - grip.y;
  }));
}

// Tuned carry staging (metres at default stature): clear the thighs, and leave room for a two-hand load.
const UP = new Vector3(0, 1, 0);
const CARRY_ASIDE = 0.24;
const CARRY_BESIDE = 0.22;
const CARRY_AHEAD = 0.35;
// Tuned lift staging: carry 12 cm above standing hip height, independent of the pelvis's squat.
const CARRY_HEIGHT = 0.12;
