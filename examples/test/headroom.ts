import { Vector3 } from 'three';
import type { Box } from '@drawcall/animate';
import { eyesOf, jointOf } from '../src/joints';
import { forwardOf } from '../src/math';
import { Peak, type Frame } from './frame';

const DEG = 180 / Math.PI;
/** the head and upper trunk points that must stay out of a box overhead */
const TOP = ['headTop', 'nose', 'leftEar', 'rightEar', 'neck', 'leftUpperArm', 'rightUpperArm'] as const;
/** strides slower than this (m/s) aren't walking */
const WALKING = 0.6;
/** hips this close to their standing height (share), and the trunk within this of vertical (°), walk upright */
const UPRIGHT = { height: 0.93, trunk: 15 };

const isBox = (o: object): o is Box => 'min' in o;
const inside = (p: Vector3, b: Box) => p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z;
/** how deep `p` is inside `b` (0 outside) */
const depth = (p: Vector3, b: Box) => Math.max(0, Math.min(p.x - b.min.x, b.max.x - p.x, p.y - b.min.y, b.max.y - p.y, p.z - b.min.z, b.max.z - p.z));

/** mean, min and max of a series */
class Series {
  private xs: number[] = [];
  add(x: number) {
    this.xs.push(x);
  }
  get n() {
    return this.xs.length;
  }
  get mean() {
    return this.xs.reduce((a, b) => a + b, 0) / (this.xs.length || 1);
  }
  get min() {
    return Math.min(...this.xs);
  }
  get max() {
    return Math.max(...this.xs);
  }
  toString() {
    return this.n ? `${this.mean.toFixed(2)} (${this.min.toFixed(2)}…${this.max.toFixed(2)})` : '–';
  }
}

/** a walk's measures: under a box overhead, or upright */
class Walk {
  /** knee and hip flexion at mid-stance (the ankle under the hip joint, °) */
  readonly knee = new Series();
  readonly hip = new Series();
  /** hip joints' height over standing (share) */
  readonly height = new Series();
  /** trunk (hips → neck) forward of vertical (°) */
  readonly trunk = new Series();
  /** the head's pitch below its standing pitch (°, + = looking further down): the nose over the ears */
  readonly gaze = new Series();
  /** fore-aft length of each step (m) */
  readonly step = new Series();
  readonly speed = new Series();
  /** the left upper arm's sagittal swing range per stride (°) */
  armRange = 0;
  private arm: number[] = [];
  frames = 0;
  airborne = 0;

  toString() {
    return `knee ${this.knee}°, hip ${this.hip}°, hip height ${this.height} × standing, trunk ${this.trunk}°, head down ${this.gaze}°, step ${this.step} m, speed ${this.speed} m/s, arm swing ${this.armRange.toFixed(0)}°, airborne frames ${this.airborne}`;
  }

  /** ends a run of frames: its arm swing range counts, if it spans a stride */
  closeArm() {
    if (this.arm.length > 60) this.armRange = Math.max(this.armRange, Math.max(...this.arm) - Math.min(...this.arm));
    this.arm = [];
  }
  addArm(a: number) {
    this.arm.push(a);
  }
}

/**
 * Walking under boxes overhead (a low ceiling among the body obstacles) against walking
 * upright: nothing of the head or upper trunk inside a box, the head already under the
 * ceiling as the eyes reach it, and the stooped gait's knee, hip, trunk, head, height and steps.
 */
export class Headroom {
  /** how deep the head or upper trunk got into a box (m) */
  readonly clip = new Peak();
  /** the head top's clearance below the box as the eyes reach its footprint (m; null: never reached) */
  entry: number | null = null;
  readonly under = new Walk();
  readonly upright = new Walk();
  private standing = 0;
  private standingGaze: number | null = null;
  private landed: (Vector3 | null)[] = [null, null];
  private ahead: (number | null)[] = [null, null];
  private eyesIn = false;
  private where: Walk | null = null;

  see({ t, h, input }: Frame) {
    const j = (n: string) => jointOf(h, n);
    const boxes = (input.bodyObstacles ?? []).filter(isBox);
    const hipY = (j('leftUpperLeg').y + j('rightUpperLeg').y) / 2;
    this.standing ||= hipY;
    for (const b of boxes) for (const n of TOP) this.clip.see(depth(j(n), b), t);
    const eyes = eyesOf(h);
    const eyesIn = boxes.some((b) => inside(eyes, b));
    if (eyesIn && !this.eyesIn && this.entry === null) this.entry = Math.min(...boxes.map((b) => b.min.y)) - j('headTop').y;
    this.eyesIn = eyesIn;

    const face = j('nose').sub(j('leftEar').add(j('rightEar')).multiplyScalar(0.5));
    const gaze = Math.atan2(-face.y, Math.hypot(face.x, face.z)) * DEG;
    this.standingGaze ??= gaze;
    const speed = Math.hypot(h.velocity.x, h.velocity.z);
    const height = hipY / this.standing;
    const fwd = forwardOf(h.yaw);
    const up = j('neck').sub(j('hips'));
    const trunk = Math.atan2(up.dot(fwd), up.y) * DEG;
    const under = boxes.some((b) => inside(j('hips'), b));
    const walk = speed < WALKING ? null : under ? this.under : height > UPRIGHT.height && trunk < UPRIGHT.trunk ? this.upright : null;
    if (walk !== this.where) this.where?.closeArm();
    this.where = walk;
    h.feet.forEach((f, s) => {
      const side = s === 0 ? 'left' : 'right';
      const hip = j(`${side}UpperLeg`);
      const knee = j(`${side}LowerLeg`);
      const ankle = j(`${side}Foot`);
      // steps: from one landing to the next foot's
      if (f.phase === 'planted' && !this.landed[s]) {
        const other = this.landed[1 - s];
        if (walk && other) walk.step.add(f.position.clone().sub(other).dot(fwd));
        this.landed[s] = f.position.clone();
      }
      if (f.phase !== 'planted') {
        this.landed[s] = null;
        this.ahead[s] = null;
        return;
      }
      // mid-stance: the ankle passes under the hip joint
      const ahead = ankle.clone().sub(hip).dot(fwd);
      const before = this.ahead[s];
      this.ahead[s] = ahead;
      if (!walk || before === null || before < 0 || ahead >= 0) return;
      const neck = j('neck').sub(j('hips'));
      walk.knee.add(180 - hip.clone().sub(knee).angleTo(ankle.clone().sub(knee)) * DEG);
      walk.hip.add(180 - neck.angleTo(knee.clone().sub(hip)) * DEG);
    });
    if (!walk) return;
    walk.frames++;
    if (h.feet.every((f) => f.phase !== 'planted')) walk.airborne++;
    walk.height.add(height);
    walk.speed.add(speed);
    walk.trunk.add(trunk);
    walk.gaze.add(gaze - this.standingGaze);
    const arm = j('leftLowerArm').sub(j('leftUpperArm'));
    walk.addArm(Math.atan2(arm.dot(fwd), -arm.y) * DEG);
  }

  toString() {
    if (!this.under.frames && this.clip.value === 0) return 'headroom: no box overhead';
    const entry = this.entry === null ? 'never reached' : `${(this.entry * 100).toFixed(1)} cm`;
    return `headroom: clip ${this.clip}, head top below the box as the eyes reach it ${entry}\n  under the box: ${this.under}\n  upright: ${this.upright}`;
  }
}
