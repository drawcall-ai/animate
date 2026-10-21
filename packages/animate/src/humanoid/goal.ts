import { Quaternion, Vector3 } from 'three';
import type { Body, Frame } from '../core/body';
import { movingPoint, type Placement } from '../core/goal';
import { loadFactor } from '../core/load';
import { heldMass } from '../core/worn';
import { isPerson, type Humanoid } from './humanoid';
import type { Side } from './bones';
import { rests } from '../core/hands';


/** A comfortable carry in front of the hips, or beside one hip for a single hand; follows the body. */
export function carried<H extends string>(body: Body<H>, hand?: H): (f: Frame) => Required<Placement> & { velocity: Vector3 } {
  // (another body's: where its hand rests)
  if (!isPerson(body)) {
    const rest = rests(body, hand ?? (Object.keys(body.hands)[0] as H));
    return (f) => ({ ...rest(f), velocity: new Vector3() });
  }
  return personCarried(body, hand as Side | undefined);
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
    // A lift rises out of its squat: its resting height follows the feet, not the lowered pelvis.
    goal.position.y = (h.feet[0].position.y + h.feet[1].position.y) / 2 + h.proportions.hipHeight + CARRY_HEIGHT * h.scale;
    goal.velocity.y = 0;
    return goal;
  };
}

// Tuned carry staging (metres at default stature): clear the thighs, and leave room for a two-hand load.
const UP = new Vector3(0, 1, 0);
const CARRY_ASIDE = 0.24;
const CARRY_BESIDE = 0.22;
const CARRY_AHEAD = 0.35;
// Tuned lift staging: carry 12 cm above standing hip height, independent of the pelvis's squat.
const CARRY_HEIGHT = 0.12;
