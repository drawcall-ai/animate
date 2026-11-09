import { INDEX } from '../../species/humanoid/bones';
import type { Proportions } from '../../species/humanoid/proportions';
import type { Stride } from '../../species/humanoid/humanoid';
import type { Legged } from '../legged';
import type { Impact } from './impact';
import type { Seat } from './seat';
import type { ArmPosture } from '../../kernel/poise';

/** A person as its legs see it: a body on legs of its proportions, and whether its hands hold anything. */
export interface PersonLegged extends Legged {
  readonly impact: Impact;
  readonly proportions: Proportions;
  /** how it strides, as multipliers on a person's defaults */
  readonly stride: Stride;
  readonly holding: Readonly<Record<string, object | null>>;
  /** what it sits on, sitting down or rising from it */
  seat: Seat | null;
  readonly armPose: Record<string, Required<ArmPosture>>;
}

/** how high the floor is under a person's feet (m): their ankles where they stand or land (as it is made, its own), less the ankle's height */
export function floorUnder(person: Pick<PersonLegged, 'stepper' | 'pose' | 'proportions'>): number {
  const [left, right] = person.stepper?.legs.map((leg) => leg.anchor.y) ?? [person.pose.position(INDEX.leftFoot).y, person.pose.position(INDEX.rightFoot).y];
  return (left + right) / 2 - person.proportions.ankleHeight;
}

/** how far its root's crouch lets a person down (m): a player's crouch key's, as far as its legs have eased it in — not the crouch a
 * reach or a story asks of its knees */
export function crouchOf(person: Pick<PersonLegged, 'stepper' | 'driven' | 'scale'>): number {
  const stepper = person.stepper;
  return stepper ? stepper.st.crouch.depth * person.scale * Math.min(stepper.crouch, person.driven?.crouch ?? 0) : 0;
}
