import { Vector3 } from 'three';
import { jointOf } from '../src/joints';
import { forwardOf } from '../src/math';
import { comOf } from './balance';
import { depthIn, PARTS, type Part } from './climb';
import type { Frame } from './frame';

const DEG = 180 / Math.PI;
/** a hand force (per kg, m/s²) beyond which the body counts as pushing or pulling hard */
const HARD = 2;

/** a band's mean and extremes */
class Mean {
  n = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  see(v: number) {
    this.n++;
    this.sum += v;
    this.min = Math.min(this.min, v);
    this.max = Math.max(this.max, v);
  }
  get mean() {
    return this.n ? this.sum / this.n : NaN;
  }
  toString() {
    return this.n ? `${this.mean.toFixed(2)} (${this.min.toFixed(2)}…${this.max.toFixed(2)})` : '–';
  }
}

/** one way of exerting a force (pushing or pulling) */
class Effort {
  /** the trunk's forward lean (°), the centre of mass ahead of the feet's midpoint along the force (m), the feet's stagger (m), each step's length (m), the speed (m/s) */
  readonly trunk = new Mean();
  readonly ahead = new Mean();
  readonly stagger = new Mean();
  readonly step = new Mean();
  readonly speed = new Mean();
  /** the elbows' flexion (°): braced arms nearly straight */
  readonly elbow = new Mean();
  /** frames */
  frames = 0;
  toString() {
    return `${this.frames} frames: trunk forward ${this.trunk}°, CoM ahead of the feet ${this.ahead} m, stagger ${this.stagger} m, steps ${this.step} m, speed ${this.speed} m/s, elbows ${this.elbow}°`;
  }
}

/**
 * Pushing and pulling with the hands (the first actor, the input's hand force past HARD):
 * how far the trunk leans, the centre of mass is held off the feet along the force, the feet
 * are staggered, how long the steps and how fast the walk.
 */
export class Pushing {
  readonly push = new Effort();
  readonly pull = new Effort();
  /** the deepest any part but the hands reaches into what is pushed (m, with its radius) */
  inside = -Infinity;
  private prev: { phase: string; position: Vector3 }[] = [];

  see({ h, input }: Frame) {
    const f = input.handForce;
    const force = f ? Math.hypot(f.x, f.z) : 0;
    // (a step: from where the foot last stood to where it lands)
    const steps = h.feet.map((ft, s) => {
      const p = this.prev[s];
      return p && p.phase !== 'planted' && ft.phase === 'planted' ? ft.position.distanceTo(p.position) : null;
    });
    this.prev = h.feet.map((ft, s) => (ft.phase === 'planted' || !this.prev[s] ? { phase: ft.phase, position: ft.position.clone() } : { phase: ft.phase, position: this.prev[s].position }));
    if (!f) return;
    const H = h.proportions.height;
    for (const k of Object.keys(PARTS) as Part[]) {
      if (k === 'hand') continue;
      for (const n of PARTS[k].joints) for (const o of input.floorObstacles ?? []) this.inside = Math.max(this.inside, depthIn(o, jointOf(h, n)) + PARTS[k].r * H);
    }
    if (force < HARD) return;
    const dir = new Vector3(f.x, 0, f.z).normalize();
    const fwd = forwardOf(h.yaw);
    const e = dir.dot(fwd) > 0 ? this.push : this.pull;
    const j = (n: string) => jointOf(h, n);
    e.frames++;
    const trunk = j('neck').sub(j('hips'));
    e.trunk.see(Math.atan2(trunk.dot(fwd), trunk.y) * DEG);
    const mid = h.feet[0].position.clone().add(h.feet[1].position).multiplyScalar(0.5);
    e.ahead.see(comOf(h).sub(mid).dot(dir));
    if (h.feet.every((ft) => ft.phase === 'planted')) e.stagger.see(Math.abs(h.feet[0].position.clone().sub(h.feet[1].position).dot(fwd)));
    for (const s of steps) if (s !== null && s > 0.05) e.step.see(s);
    e.speed.see(Math.hypot(h.velocity.x, h.velocity.z));
    for (const side of ['left', 'right']) {
      const elbow = j(`${side}LowerArm`);
      e.elbow.see(180 - j(`${side}UpperArm`).sub(elbow).angleTo(j(`${side}Hand`).sub(elbow)) * DEG);
    }
  }

  toString() {
    return this.push.frames || this.pull.frames ? `pushing: ${this.push}, deepest into what is pushed ${(this.inside * 100).toFixed(1)} cm\npulling: ${this.pull}` : 'pushing: none';
  }
}
