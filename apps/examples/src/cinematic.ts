import { MathUtils, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { Pose } from '@prohuman/core';

/**
 * Recording camera: the normal third-person orbit shot, then a motion-designed move into
 * fighter 0's eyes — a slight anticipation pull-back, an accelerating arc around behind the
 * head while dollying in (FOV rush, banked roll, the look sliding onto the opponent), a push
 * through the head, and a landing (FOV settles with overshoot, a short jolt). First person
 * follows the head (smoothed), so hits jolt the view.
 */
export interface Shot {
  pos: Vector3;
  look: Vector3;
  fov: number;
}

const T0 = 7.0; // transition start (s)
const T1 = 8.5; // arrival in first person
const FP_FOV = 74;

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeInOutQuint = (x: number) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2);
const easeOutBack = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const smooth = (a: number, b: number, x: number) => {
  const k = span(x, a, b);
  return k * k * (3 - 2 * k);
};

/** critically damped smoothing of a vector toward a moving target */
class Follow {
  readonly value = new Vector3();
  private readonly vel = new Vector3();
  private init = false;
  step(target: Vector3, omega: number, dt: number) {
    if (!this.init) {
      this.value.copy(target);
      this.init = true;
      return this.value;
    }
    const e = Math.exp(-omega * dt);
    for (const k of ['x', 'y', 'z'] as const) {
      const d = this.value[k] - target[k];
      const c = this.vel[k] + omega * d;
      this.value[k] = target[k] + (d + c * dt) * e;
      this.vel[k] = (this.vel[k] - omega * c * dt) * e;
    }
    return this.value;
  }
}

const _up = new Vector3(0, 1, 0);
const _z = new Vector3(0, 0, 1);
const _q = new Quaternion();

export class CinematicCamera {
  private head = new Follow();
  private eye = new Follow();
  private gaze = new Follow();

  /** true while the camera is inside/near fighter 0's head: hide that head (as FPS games do) */
  hideOwnHead = false;

  apply(camera: PerspectiveCamera, t: number, dt: number, poses: Pose[], third: Shot) {
    const [a, b] = poses;
    const h0 = this.head.step(a.headCenter, 8, dt);
    const fwd = a.nose.clone().sub(a.headCenter).setY(0).normalize();
    // the real eyes (the own head is hidden up close), so the guard sits a natural distance away
    const eye = this.eye.step(a.leftEye.clone().add(a.rightEye).multiplyScalar(0.5).addScaledVector(fwd, 0.01), 22, dt);
    // where the head points, pulled toward the opponent's chest (brings the guard into frame)
    const gazeTarget = a.headCenter
      .clone()
      .addScaledVector(a.nose.clone().sub(a.headCenter).normalize(), 4)
      .lerp(b.neck.clone().setY(b.neck.y - 0.3), 0.6);
    const gaze = this.gaze.step(gazeTarget, 9, dt);

    let pos: Vector3, look: Vector3, fov: number;
    let roll = 0;
    if (t < T0) {
      ({ pos, look, fov } = third);
    } else if (t < T1) {
      const k = span(t, T0, T1);
      // arc around the head in spherical coordinates: from the orbit camera's bearing to
      // just behind the head, radius shrinking late (swing first, then dive in)
      const v0 = third.pos.clone().sub(h0);
      const r0 = v0.length();
      const az0 = Math.atan2(v0.x, v0.z);
      const el0 = Math.asin(MathUtils.clamp(v0.y / r0, -1, 1));
      const azB = Math.atan2(-fwd.x, -fwd.z);
      let dAz = azB - az0;
      while (dAz > Math.PI) dAz -= 2 * Math.PI;
      while (dAz < -Math.PI) dAz += 2 * Math.PI;
      const swing = easeInOutCubic(smooth(0.05, 0.85, k));
      // anticipation: back out ~6 % first, then dive
      const back = 1 + 0.06 * Math.sin(Math.PI * span(k, 0, 0.25));
      const r = MathUtils.lerp(r0 * back, 0.32, easeInOutQuint(smooth(0.1, 0.9, k)));
      const az = az0 + dAz * swing;
      const el = MathUtils.lerp(el0, 0.12, swing);
      const arc = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(r).add(h0);
      // the last stretch pushes through the head into the eyes
      pos = arc.lerp(eye, smooth(0.78, 1, k));
      look = third.look.clone().lerp(gaze, easeInOutCubic(smooth(0.1, 0.9, k)));
      // FOV: a touch tighter on the anticipation, then the rush as the camera dives in
      fov = third.fov - 4 * Math.sin(Math.PI * span(k, 0, 0.25)) + (100 - third.fov) * smooth(0.45, 1, k) ** 2;
      // bank into the swing
      roll = -Math.sign(dAz) * 0.1 * Math.sin(Math.PI * smooth(0.1, 1, k));
    } else {
      // landing: FOV settles from the rush with a slight overshoot, a short decaying jolt
      const k = span(t, T1, T1 + 0.9);
      pos = eye.clone();
      look = gaze.clone();
      fov = MathUtils.lerp(100, FP_FOV, easeOutBack(k));
      const jolt = Math.exp(-7 * (t - T1)) * 0.025;
      pos.add(new Vector3(Math.sin(t * 61) * jolt, Math.sin(t * 47 + 1) * jolt, Math.sin(t * 53 + 2) * jolt));
    }

    this.hideOwnHead = pos.distanceTo(a.headCenter) < 0.45;
    camera.position.copy(pos);
    camera.up.copy(_up);
    camera.lookAt(look);
    if (roll) camera.quaternion.multiply(_q.setFromAxisAngle(_z, roll));
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}
