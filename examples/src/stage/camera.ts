import { Vector3, type PerspectiveCamera } from 'three';
import { forwardOf, leftOf } from '../math';

/** `orbit` = free (OrbitControls); the others are fixed shots relative to the body's facing */
export type View = 'orbit' | 'front' | 'side' | 'back' | 'three' | 'top';
export type Shot = Exclude<View, 'orbit'>;
export const VIEWS: View[] = ['orbit', 'front', 'side', 'three', 'back', 'top'];

/**
 * What the camera frames: a point on the body's travel path (the gait root, not the
 * pelvis — the hips' sway and bob shouldn't rock the camera) and the body's facing.
 */
export class Framing {
  readonly focus = new Vector3(0, 1, 0);
  yaw = 0;

  set(focus: Vector3, yaw: number) {
    this.focus.copy(focus);
    this.yaw = yaw;
  }

  /** frame-rate independent smoothing toward the target */
  follow(focus: Vector3, yaw: number, dt: number) {
    this.focus.lerp(focus, 1 - Math.exp(-5 * dt));
    this.yaw += (yaw - this.yaw) * (1 - Math.exp(-2.45 * dt));
  }
}

/** Puts `camera` `distance` from the framing's focus, on `shot`'s side of the body, looking at it. */
export function placeCamera(camera: PerspectiveCamera, shot: Shot, { focus, yaw }: Framing, distance: number) {
  const f = forwardOf(yaw);
  const l = leftOf(yaw);
  const dir = new Vector3();
  if (shot === 'front') dir.copy(f).setY(0.06);
  if (shot === 'back') dir.copy(f).negate().setY(0.06);
  // looking at the right side
  if (shot === 'side') dir.copy(l).negate().setY(0.06);
  if (shot === 'three') dir.copy(f).multiplyScalar(0.75).addScaledVector(l, -0.66).normalize().setY(0.32);
  if (shot === 'top') dir.set(f.x * 0.02, 1, f.z * 0.02);
  dir.normalize();
  const target = focus.clone();
  if (shot === 'top') target.y = 0.5;
  camera.position.copy(target).addScaledVector(dir, shot === 'top' ? distance * 1.1 : distance);
  camera.lookAt(target);
}
