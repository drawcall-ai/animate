import { INDEX } from '../anatomy/bones';
import type { Person } from '../person';

/** how high the floor is under a person's feet (m): their ankles where they stand or land (as it is made, its own), less the ankle's height */
export function floorUnder(person: Pick<Person, 'stepper' | 'pose' | 'proportions'>): number {
  const [left, right] = person.stepper?.legs.map((leg) => leg.anchor.y) ?? [person.pose.position(INDEX.leftFoot).y, person.pose.position(INDEX.rightFoot).y];
  return (left + right) / 2 - person.proportions.ankleHeight;
}

/** how far its root's crouch lets a person down (m): a player's crouch key's, as far as its legs have eased it in — not the crouch a
 * reach or a story asks of its knees */
export function crouchOf(person: Pick<Person, 'stepper' | 'driven' | 'scale'>): number {
  const stepper = person.stepper;
  return stepper ? stepper.st.crouch.depth * person.scale * Math.min(stepper.crouch, person.driven?.crouch ?? 0) : 0;
}
