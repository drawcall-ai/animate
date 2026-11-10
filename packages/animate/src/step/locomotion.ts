import { Vector3 } from 'three';

/** Walk state, of any legs: the legs report the motion. */
export interface Locomotion {
  /** the facing it walks with (rad, about +Y) and its ground velocity (m/s) */
  facing: number;
  velocity: Vector3;
  /** a walk is under way */
  moving: boolean;
  /** come to rest: no walk under way, both feet planted a while and none wanting to step */
  settled: boolean;
  /** the legs hold the walk's still goal reached, as near as they take the body to it (a creature stops just short of or past it rather than
   * edging about); a walk ends there as it does within its own reach of the goal */
  atGoal: boolean;
}

export const createLocomotion = (facing: number): Locomotion => ({
  facing, velocity: new Vector3(), moving: false, settled: true, atGoal: false,
});
