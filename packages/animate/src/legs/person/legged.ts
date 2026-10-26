import type { Proportions } from '../../species/humanoid/proportions';
import type { Legged } from '../legged';
import type { Foot } from './foot';

/** A person as its legs see it: a body on legs of its proportions, where its feet stand, and whether its hands hold anything. */
export interface PersonLegged extends Legged {
  readonly proportions: Proportions;
  /** where the feet stand or, stepping, land [left, right] */
  readonly feet: [Foot, Foot];
  readonly holding: Readonly<Record<string, object | null>>;
}
