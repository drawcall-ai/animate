import { Vector3 } from 'three';

/** Walk state, of any legs: the legs report the motion; walkTo publishes and clears its arrival estimate. */
export interface Locomotion {
  /** the stride's phase (rad): 0 as the left foot lifts, π as the right does */
  phase: number;
  /** 0 standing … 1 walking, 0 walking … 1 running */
  walk: number;
  run: number;
  /** the facing it walks with (rad, about +Y) and its ground velocity (m/s) */
  facing: number;
  /** the heading it will walk with half a second ahead (rad), for the eyes to lead */
  facingAhead?: number;
  velocity: Vector3;
  /** seconds until the walk now running arrives; Infinity when no walk is running; published and cleared by walkTo */
  eta: number;
  /** a walk is under way */
  moving: boolean;
  /** come to rest: no walk under way, both feet planted a while and none wanting to step */
  settled: boolean;
  /** the legs hold the walk's still goal reached, as near as they take the body to it (a creature stops just short of or past it rather than
   * edging about); a walk ends there as it does within its own reach of the goal */
  there: boolean;
  /** seconds standing on planted feet since the current walk started; the base resets it on a new walk */
  planted: number;
  /** the pelvis's and the thorax's turn with the stride (rad, + to the left) */
  pelvisYaw: number;
  thoraxYaw: number;
  /** the requested quiet stance displacement from the centred stance (m, world) */
  quiet: Vector3;
}

export const createLocomotion = (facing: number): Locomotion => ({
  eta: Infinity, phase: 0, walk: 0, run: 0, facing, velocity: new Vector3(), moving: false, settled: true, there: false, planted: 0,
  pelvisYaw: 0, thoraxYaw: 0, quiet: new Vector3(),
});
