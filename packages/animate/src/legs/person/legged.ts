import { INDEX } from '../../species/humanoid/bones';
import type { Proportions } from '../../species/humanoid/proportions';
import type { Legged } from '../legged';

/** A person as its legs see it: a body on legs of its proportions, and whether its hands hold anything. */
export interface PersonLegged extends Legged {
  readonly proportions: Proportions;
  readonly holding: Readonly<Record<string, object | null>>;
}

/** how high the floor is under a person's feet (m): their ankles where they stand or land (as it is made, its own), less the ankle's height */
export function floorUnder(person: Pick<PersonLegged, 'stepper' | 'pose' | 'proportions'>): number {
  const [left, right] = person.stepper?.legs.map((leg) => leg.anchor.y) ?? [person.pose.position(INDEX.leftFoot).y, person.pose.position(INDEX.rightFoot).y];
  return (left + right) / 2 - person.proportions.ankleHeight;
}
