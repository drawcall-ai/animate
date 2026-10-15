import { Vector3, type PerspectiveCamera } from 'three';
import { forwardOf, leftOf, Spring } from '../math';

/** `orbit` = free (OrbitControls); the others are fixed shots relative to the body's facing */
export type View = 'orbit' | 'front' | 'side' | 'back' | 'three' | 'top';
export type Shot = Exclude<View, 'orbit'>;
export const VIEWS: View[] = ['orbit', 'front', 'side', 'three', 'back', 'top'];

/** how quickly the camera takes up the body's travel and its turns (1/s): far below a walk's footfalls (~12 rad/s), of whose surges the travel then passes on ~3% */
const TRAVEL = 2;
const TURN = 2.5;

/**
 * What the camera frames: a point at a fixed height over the body's travel (the pelvis's ground
 * point, which surges ahead at each footfall and sways side to side with the steps), and the way
 * the body faces. Both follow on critically damped springs, the travel fed balance's ground
 * velocity, so the camera keeps up with a walk without lagging and without the stride's surges.
 */
export class Framing {
  private readonly travel = new Spring();
  /** the facing as a direction: smoothed without wrapping */
  private readonly heading = new Spring();
  yaw = 0;

  get focus(): Readonly<Vector3> {
    return this.travel.value;
  }

  set(focus: Vector3, yaw: number) {
    this.travel.reset(focus);
    this.heading.reset(forwardOf(yaw, _f));
    this.yaw = yaw;
  }

  /** `velocity` = how the focus moves (m/s); `dt` = display frame time */
  follow(focus: Vector3, velocity: Vector3, yaw: number, dt: number) {
    this.travel.step(focus, TRAVEL, dt, velocity);
    const f = this.heading.step(forwardOf(yaw, _f), TURN, dt);
    this.yaw = Math.atan2(f.x, f.z);
  }
}

const _f = new Vector3();

/** Puts `camera` `distance` from the framing's focus, on `shot`'s side of the body, looking at it. */
export function placeCamera(camera: PerspectiveCamera, shot: Shot, { focus, yaw }: Framing, distance: number, bearing?: number) {
  const f = forwardOf(yaw);
  const l = leftOf(yaw);
  const dir = new Vector3();
  if (shot === 'front') dir.copy(f).setY(0.06);
  if (shot === 'back') dir.copy(f).negate().setY(0.06);
  // looking at the right side
  if (shot === 'side') dir.copy(l).negate().setY(0.06);
  if (shot === 'three') dir.copy(f).multiplyScalar(0.75).addScaledVector(l, -0.66).normalize().setY(0.32);
  if (shot === 'top') dir.set(f.x * 0.02, 1, f.z * 0.02);
  if (bearing !== undefined) dir.copy(forwardOf(bearing)).setY(0.06);
  dir.normalize();
  const target = focus.clone();
  if (shot === 'top') target.y = 0.5;
  camera.position.copy(target).addScaledVector(dir, shot === 'top' ? distance * 1.1 : distance);
  camera.lookAt(target);
}
