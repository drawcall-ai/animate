import type { Look } from '../scenario';
import { Vector3, type Box3, type PerspectiveCamera } from 'three';

/** `orbit` = free (OrbitControls); the others are fixed shots relative to the body's facing */
export type View = 'orbit' | 'front' | 'side' | 'back' | 'three' | 'top' | 'first' | 'third';
export type Shot = Exclude<View, 'orbit'>;
export const VIEWS: View[] = ['orbit', 'front', 'side', 'three', 'back', 'top', 'first', 'third'];

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
export function placeCamera(camera: PerspectiveCamera, shot: Shot, { focus, yaw }: Framing, distance: number, bounds: Box3, bearing?: number) {
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
  const right = new Vector3().crossVectors(camera.up, dir).normalize();
  const up = new Vector3().crossVectors(dir, right);
  const tan = Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
  const corner = new Vector3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    corner.set(x, y, z).sub(target);
    distance = Math.max(distance, corner.dot(dir) + Math.max(Math.abs(corner.dot(up)) / tan, Math.abs(corner.dot(right)) / (tan * camera.aspect)));
  }
  camera.position.copy(target).addScaledVector(dir, distance);
  camera.lookAt(target);
}

/** Recalled: full-body first person and an over-the-shoulder third-person camera (Unreal/Unity).
 * Tuned camera response: soften step bob, retain movement; camera state never enters simulation.
 */
export class PlayerCamera {
  private readonly eye = new Spring();
  private ads = 0;

  /** shows `look` — the one the simulation placed the aim in, as shown (not the input's newest: the rifle would trail it) */
  apply(camera: PerspectiveCamera, { eye: actual, yaw, pitch }: Look, ads: boolean, view: 'first' | 'third', dt: number) {
    const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // Tuned 250 ms ADS blend: near sights need the body's eye, not a lagging camera origin.
    this.ads += Math.max(-dt / 0.25, Math.min(dt / 0.25, Number(ads) - this.ads));
    const eye = this.eye.step(actual, 24, dt).clone();
    if (view === 'first') eye.lerp(actual, this.ads * this.ads * (3 - 2 * this.ads));
    camera.position.copy(eye);
    if (view === 'third') camera.position.addScaledVector(direction, -2.4).addScaledVector(leftOf(yaw), -0.55).y += 0.15;
    camera.lookAt(eye.clone().addScaledVector(direction, 20));
    camera.fov = view === 'first' ? 90 : 65;
    camera.near = 0.02;
    camera.updateProjectionMatrix();
  }
}

/**
 * A vector following a moving target on a critically damped spring; it starts on the first target
 * (or `reset`). Given the target's velocity, it follows without lagging (the spring then works only
 * on how the target strays from moving at that velocity). Each step is exact for the target
 * having moved at that velocity through it, so the result doesn't depend on the frame rate.
 */
class Spring {
  readonly value = new Vector3();
  private readonly velocity = new Vector3();
  private started = false;

  step(target: Vector3, omega: number, dt: number, targetVelocity: Vector3 = STILL): Vector3 {
    if (!this.started) return this.reset(target);
    const e = Math.exp(-omega * dt);
    for (const k of ['x', 'y', 'z'] as const) {
      const u = targetVelocity[k];
      // (from where the target was as the step began)
      const delta = this.value[k] - target[k] + u * dt;
      const dv = this.velocity[k] - u;
      const c = dv + omega * delta;
      this.value[k] = target[k] + (delta + c * dt) * e;
      this.velocity[k] = u + (dv - omega * c * dt) * e;
    }
    return this.value;
  }

  reset(to: Vector3): Vector3 {
    this.started = true;
    this.velocity.set(0, 0, 0);
    return this.value.copy(to);
  }
}

const STILL = new Vector3();

/** the way yaw `yaw` faces on the floor (0 faces +Z, positive turns toward +X), into `out` */
const forwardOf = (yaw: number, out = new Vector3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw));

/** the left of a body facing `yaw` on the floor, into `out` */
const leftOf = (yaw: number, out = new Vector3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));
