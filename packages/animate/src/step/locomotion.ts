import { Vector3 } from 'three';

/** Walk state, of any legs: the legs report the motion. */
export interface Locomotion {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase: number;
  /** 0 standing … 1 walking, 0 walking … 1 running */
  walk: number; run: number;
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
  /** the pelvis's and the thorax's turn with the stride (rad, + to the left) */
  pelvisYaw: number; thoraxYaw: number;
  /** how far the trunk bows forward as the legs carry it (rad, + forward; − arched back): a story's, a reach's, a look's and a crouch's */
  bow: number;
  /** the requested quiet stance displacement from the centred stance (m, world) */
  quiet: Vector3;
  /** how far its arms swing walking, as its legs have it (1: as tuned) */
  arms: number;
}

export const createLocomotion = (facing: number): Locomotion => ({
  phase: 0, walk: 0, run: 0, facing, velocity: new Vector3(), moving: false, settled: true, atGoal: false,
  pelvisYaw: 0, thoraxYaw: 0, bow: 0, quiet: new Vector3(), arms: 1,
});
