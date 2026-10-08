import { Vector3 } from 'three';
import type { Box } from '@prohuman/core';
import { jointOf } from '../src/joints';
import { forwardOf } from '../src/math';
import { FIXED_DT } from '../src/scenario';
import type { Frame } from './frame';

const DEG = 180 / Math.PI;
const SIDES = ['left', 'right'] as const;
const SOLE = ['Heel', 'BigToe', 'SmallToe'] as const;
/** the most a step rises (× height): beyond it, a climb */
const STEP = 0.26;

/** the ground's height at a point: the highest box top holding it, else the floor's */
export const groundAt = (ground: readonly Box[], p: Vector3) =>
  Math.max(0, ...ground.filter((o) => p.x >= o.min.x && p.x <= o.max.x && p.z >= o.min.z && p.z <= o.max.z).map((o) => o.max.y));

/** a band of values: least, most, mean */
class Band {
  min = Infinity;
  max = -Infinity;
  private sum = 0;
  n = 0;
  see(v: number) {
    this.min = Math.min(this.min, v);
    this.max = Math.max(this.max, v);
    this.sum += v;
    this.n++;
  }
  get mean() {
    return this.n ? this.sum / this.n : NaN;
  }
  toString() {
    return this.n ? `${this.min.toFixed(1)}–${this.max.toFixed(1)} (mean ${this.mean.toFixed(1)})` : '–';
  }
}

/** one way on stairs (going up or down): the measures of its frames and steps */
class Way {
  /** the trunk's forward lean (°), the knee at each contact (°), each swing's peak knee (°), the hip at each contact (°) */
  readonly trunk = new Band();
  readonly contactKnee = new Band();
  readonly swingKnee = new Band();
  readonly contactHip = new Band();
  /** the toes' least clearance over the ground mid-swing (cm) */
  readonly clearance = new Band();
  /** each contact's foot pitch (°, + = toes down: a forefoot landing) */
  readonly strike = new Band();
  /** steps, and the time from the first to the last (s) */
  steps = 0;
  first = Infinity;
  last = -Infinity;
  get cadence() {
    return this.steps > 1 ? (this.steps - 1) / (this.last - this.first) : NaN;
  }
  toString() {
    return `${this.steps} steps at ${this.cadence.toFixed(2)}/s, trunk ${this.trunk}°, knee at contact ${this.contactKnee}°, hip at contact ${this.contactHip}°, swing knee peak ${this.swingKnee}°, foot at contact ${this.strike}° toes down, toe clearance mid-swing ${this.clearance} cm`;
  }
}

interface Swing {
  from: number;
  t0: number;
  knee: number;
  /** the least clearance of its sole points over the ground, mid-swing */
  clear: number;
  samples: { t: number; clear: number }[];
}

/**
 * Walking over ground boxes (stairs), of the first actor: the planted feet flat on one tread
 * each (not across a nose), one riser a step, no sole into a step, the hips rising steadily
 * going up; and going up and going down: the trunk's lean, the knees and hips at contact and
 * in the swing, the cadence, how the foot lands and how far the toes clear the noses.
 */
export class Stairs {
  readonly up = new Way();
  readonly down = new Way();
  /** a planted foot's ball off its tread (m), once landed */
  tilt = 0;
  /** planted feet standing across an edge: their ball not over the tread they stand on (frames) */
  straddles = 0;
  /** the most a step rises or drops from the last footfall (m) */
  rise = 0;
  /** the deepest a sole point reaches into the ground (m), and when */
  sink = 0;
  sinkAt = 0;
  /** the hips' biggest dip below their highest so far while going up (m) */
  dip = 0;
  /** the feet's (ankles') and the hips' peak acceleration (m/s²): a pop shows as a spike */
  readonly accel = { feet: 0, feetAt: 0, hips: 0, hipsAt: 0 };
  private track: Vector3[][] = [[], [], []];
  private ground: readonly Box[] = [];
  private prev: { phase: string; level: number; t: number }[] | null = null;
  /** the last footfall's level, and which way the stairs go (+1 up, −1 down, 0 level) */
  private lastLevel = NaN;
  private way = 0;
  private swings: (Swing | null)[] = [null, null];
  private hipsHigh = -Infinity;

  see({ t, h, input }: Frame) {
    const ground = input.ground ?? [];
    if (!ground.length || input.leftHand || input.rightHand) return;
    this.ground = ground;
    const d = h.proportions;
    const j = (n: string) => jointOf(h, n);
    const angle = (a: Vector3, b: Vector3, c: Vector3) => 180 - a.clone().sub(b).angleTo(c.clone().sub(b)) * DEG;
    const fwd = forwardOf(h.yaw);
    const trunk = j('neck').sub(j('hips'));
    const lean = Math.atan2(trunk.dot(fwd), trunk.y) * DEG;
    const hipsY = (j('leftUpperLeg').y + j('rightUpperLeg').y) / 2;
    for (const [s, side] of SIDES.entries()) {
      const f = h.feet[s];
      const level = f.position.y - d.ankleHeight;
      const soles = SOLE.map((n) => j(`${side}${n}`));
      for (const p of soles) {
        const sink = groundAt(this.ground, p) - p.y;
        if (sink > this.sink) [this.sink, this.sinkAt] = [sink, t];
      }
      const knee = angle(j(`${side}UpperLeg`), j(`${side}LowerLeg`), j(`${side}Foot`));
      const prev = this.prev?.[s];
      if (f.phase === 'planted' && prev && prev.phase !== 'planted') {
        // a footfall: which way it went, and how the body meets it
        // (more than a step: climbed up, not a stair)
        const rise = Number.isNaN(this.lastLevel) || Math.abs(level - this.lastLevel) > STEP * d.height ? 0 : level - this.lastLevel;
        this.rise = Math.max(this.rise, Math.abs(rise));
        this.way = rise > 0.01 ? 1 : rise < -0.01 ? -1 : 0;
        this.lastLevel = level;
        const w = this.way > 0 ? this.up : this.way < 0 ? this.down : null;
        if (w) {
          w.steps++;
          w.first = Math.min(w.first, t);
          w.last = t;
          w.contactKnee.see(knee);
          w.contactHip.see(angle(j('neck'), j(`${side}UpperLeg`), j(`${side}LowerLeg`)));
          const toe = j(`${side}BigToe`).add(j(`${side}SmallToe`)).multiplyScalar(0.5);
          w.strike.see(Math.atan2(soles[0].y - toe.y, soles[0].clone().sub(toe).setY(0).length()) * DEG);
        }
        const sw = this.swings[s];
        if (w && sw && Math.abs(level - sw.from) > 0.01) {
          w.swingKnee.see(sw.knee);
          // (mid-swing: its middle 60%)
          const span = t - sw.t0;
          const mid = sw.samples.filter((q) => q.t > sw.t0 + 0.2 * span && q.t < t - 0.2 * span).map((q) => q.clear);
          if (mid.length) w.clearance.see(100 * Math.min(...mid));
        }
        this.swings[s] = null;
      }
      if (f.phase === 'swing') {
        const sw = (this.swings[s] ??= { from: prev?.level ?? level, t0: t, knee: 0, clear: Infinity, samples: [] });
        sw.knee = Math.max(sw.knee, knee);
        const toes = soles.slice(1);
        sw.samples.push({ t, clear: Math.min(...toes.map((p) => p.y - groundAt(this.ground, p))) });
      }
      if (f.phase === 'planted' && prev?.phase === 'planted' && t - prev.t > 0.15) {
        const ball = j(`${side}Toes`);
        this.tilt = Math.max(this.tilt, Math.abs(ball.y - level));
        if (Math.abs(groundAt(this.ground, ball) - level) > 0.01) this.straddles++;
      }
    }
    // (the ankles and the hip joints' midpoint, three frames: their acceleration)
    const points = [j('leftFoot'), j('rightFoot'), j('leftUpperLeg').add(j('rightUpperLeg')).multiplyScalar(0.5)];
    points.forEach((p, i) => {
      const k = this.track[i];
      k.push(p);
      if (k.length > 3) k.shift();
      if (k.length < 3) return;
      const a = k[2].clone().sub(k[1]).sub(k[1]).add(k[0]).length() / FIXED_DT ** 2;
      if (i < 2 && a > this.accel.feet) [this.accel.feet, this.accel.feetAt] = [a, t];
      if (i === 2 && a > this.accel.hips) [this.accel.hips, this.accel.hipsAt] = [a, t];
    });
    this.prev = h.feet.map((f, s) => {
      const p = this.prev?.[s];
      const since = p && p.phase === f.phase ? p.t : t;
      return { phase: f.phase, level: f.position.y - d.ankleHeight, t: since };
    });
    if (this.way > 0) {
      this.up.trunk.see(lean);
      this.hipsHigh = Math.max(this.hipsHigh, hipsY);
      this.dip = Math.max(this.dip, this.hipsHigh - hipsY);
    } else this.hipsHigh = -Infinity;
    if (this.way < 0) this.down.trunk.see(lean);
  }

  toString() {
    if (!this.ground.length) return 'stairs: none';
    const cm = (m: number) => (m * 100).toFixed(1);
    return `stairs: planted balls off the tread ${cm(this.tilt)} cm, ${this.straddles} straddling frames, step rise max ${cm(this.rise)} cm, soles into the ground ${cm(this.sink)} cm @${this.sinkAt.toFixed(2)}s, hips' dip going up ${cm(this.dip)} cm, peak acceleration: feet ${this.accel.feet.toFixed(0)} m/s² @${this.accel.feetAt.toFixed(2)}s, hips ${this.accel.hips.toFixed(1)} m/s² @${this.accel.hipsAt.toFixed(2)}s\n  up: ${this.up}\n  down: ${this.down}`;
  }
}
