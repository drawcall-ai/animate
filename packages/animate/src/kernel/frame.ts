import type { Dev } from './dev';
import type { BonePose, ReadonlyBonePose } from './bone-pose';

/** the sub-step (s): fixed, so that what is read off the pose history (velocities) does not depend on the frame rate */
export const SUBSTEP = 1 / 60;

/**
 * What a body's motion gets each sub-step: the two last final poses and the pose being written. `current` starts as a copy of `prev`;
 * the body's behaviours write it in their fixed order. The poses rotate every sub-step: read them from the frame each time, do not
 * keep them.
 */
export interface Frame {
  /** the sub-step's length (s): always `SUBSTEP` */
  dt: number;
  /** the time `current` is posed for (s); the body starts at 0 */
  time: number;
  prev2: ReadonlyBonePose;
  prev: ReadonlyBonePose;
  current: BonePose;
  readonly dev?: Dev;
}

/** a body part's behaviour this sub-step */
export type Behaviour = (f: Frame) => void;
