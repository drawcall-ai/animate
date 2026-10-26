import type { Dev } from './dev';
import type { Pose, ReadonlyPose } from './pose';

/** the sub-step (s): fixed, so that what is read off the pose history (velocities) does not depend on the frame rate */
export const STEP = 1 / 60;

/**
 * What a body's motion gets each sub-step: the two last final poses and the pose being written. `current` starts as a copy of
 * `prev`; the body's behaviours write it in their fixed order. The poses rotate every sub-step: read them from the frame each time,
 * do not keep them.
 */
export interface Frame {
  /** the sub-step's length (s): always `STEP` */
  dt: number;
  /** the time `current` is posed for (s); the body starts at 0 */
  time: number;
  /** the final pose two sub-steps ago */
  prev2: ReadonlyPose;
  /** the final pose of the last sub-step */
  prev: ReadonlyPose;
  /** this sub-step's pose, as written so far */
  current: Pose;
  readonly dev?: Dev;
}

/** a body part's behaviour this sub-step */
export type Step = (f: Frame) => void;
