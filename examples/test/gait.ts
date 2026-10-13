import { Vector3 } from 'three';
import { eyesOf, jointOf } from '../src/joints';
import { forwardOf, leftOf } from '../src/math';
import type { Frame } from './frame';

/** a stride is steady when its speed stays within this share of its mean */
const STEADY = 0.12;
/** a stride turning faster than this (rad/s) is on a curve */
const CURVE = 0.15;
/** strides slower than this (m/s) aren't walking */
const MIN_SPEED = 0.6;
/** strides travelling along the facing by less than this share of their speed are side-steps or backing up, not the walk measured here */
const FORWARD = 0.8;
/** strides with the trunk flexed further than this (rad), or the stride before, are a stooped walk (or going into or out of one), not the upright gait measured here */
const STOOPED = 0.26;
/** how long before the first step and after coming to rest setting off and stopping count (s) */
const TRANSITION = 1;
/** strides faster than this (m/s) are running */
export const RUNNING = 2;

const DEG = 180 / Math.PI;

/** one frame of what the gait kinematics are measured from */
interface Sample {
  t: number;
  yaw: number;
  speed: number;
  /** ground speed along the facing (m/s) */
  ahead: number;
  hips: Vector3;
  chest: Vector3;
  head: Vector3;
  /** pelvic obliquity (+ = left hip up), rotation (+ = left hip forward), thorax roll and yaw, trunk lean (hips → neck, + = to the left), head roll and yaw (rad) */
  pelvisRoll: number;
  pelvisYaw: number;
  thoraxRoll: number;
  thoraxYaw: number;
  lean: number;
  headRoll: number;
  headYaw: number;
  /** foot phases: planted = true */
  planted: [boolean, boolean];
  /** sagittal angles (+ = forward): left upper arm, right thigh — contralateral pair */
  arm: number;
  thigh: number;
  /** trunk (hips → neck) and pelvis (hips → spine) pitch, forward of vertical (rad) */
  trunk: number;
  pelvis: number;
  /** the left knee's flexion, and the left ankle's angle between shank and foot (rad; larger = plantarflexed) */
  knee: number;
  ankle: number;
}

/** how fast the trunk and pelvis pitch (peak, °/s) */
export interface Rates {
  trunk: number;
  pelvis: number;
}

/** per-stride measures (m, °, m/s³) */
export interface Stride {
  /** when it began and ended (s) */
  from: number;
  to: number;
  curve: boolean;
  speed: number;
  /** lateral peak to peak: pelvis, chest, head (m) */
  pelvisLat: number;
  chestLat: number;
  headLat: number;
  /** pelvis vertical peak to peak (m) */
  pelvisUp: number;
  /** angle amplitudes (half peak to peak, °) */
  obliquity: number;
  rotation: number;
  thoraxToPelvisRoll: number;
  lean: number;
  thoraxToPelvisYaw: number;
  headRoll: number;
  headYaw: number;
  /** thorax vs pelvis rotation correlation (−1 = counter-rotating) */
  counter: number;
  /** RMS lateral jerk of the chest (m/s³) */
  chestJerk: number;
  /** lateral motion not explained by one sinusoid at the stride frequency, relative to it (RMS ratio) */
  pelvisResidual: number;
  chestResidual: number;
  /** pelvis lateral shift toward the stance foot at mid-stance, relative to its amplitude (+1 = over the stance foot) */
  phase: number;
  /** pelvis height at mid-stance relative to double support, relative to its amplitude (+1 = highest at mid-stance) */
  bobPhase: number;
  /** left arm swing against the right thigh: correlation at zero lag (+1 = in phase: forward together), the lag of best correlation (share of the stride, + = arm late) and the arm's swing cycles per stride */
  armCorrelation: number;
  armLag: number;
  armCycles: number;
  /** left upper arm's swing range (°) */
  armRange: number;
  /** the arm's swing against one sinusoid at the stride frequency: its share of the variance (R²), its turning points, and its peak angular acceleration over the sinusoid's */
  armFit: number;
  armTurns: number;
  armAcceleration: number;
  /** thorax roll against its rotation (+1: the shoulder going forward rises) */
  rollWithYaw: number;
  /** the head's rotation over the thorax's (both in the heading frame): the share it goes along with */
  headCarry: number;
  /** the trunk's forward-back pitch (half peak to peak, °) */
  nod: number;
  /** the left ankle's push-off: plantarflexion around lift-off beyond its stance's most dorsiflexed (°) */
  pushOff: number;
  /** the left knee's flexion three quarters through its swing (°): still bent, not reaching out straight early */
  lateKnee: number;
}

/**
 * Gait kinematics of the first actor over its steady strides (left touch-down to left
 * touch-down), in the body's heading frame: lateral and vertical excursions about the
 * path (a moving average over one stride), pelvis / thorax / head angles, smoothness and
 * the phase of the sway.
 */
export class GaitKinematics {
  private readonly samples: Sample[] = [];
  private cached: Stride[] | null = null;

  see({ t, h }: Frame) {
    const j = (n: string) => jointOf(h, n);
    const yaw = h.gait.facing;
    const fwd = forwardOf(yaw);
    const left = leftOf(yaw);
    const angles = (l: Vector3, r: Vector3) => {
      const d = l.sub(r);
      const across = d.dot(left);
      return { roll: Math.atan2(d.y, across), yaw: Math.atan2(d.dot(fwd), across) };
    };
    const pelvis = angles(j('leftUpperLeg'), j('rightUpperLeg'));
    const thorax = angles(j('leftUpperArm'), j('rightUpperArm'));
    const head = angles(j('leftEye'), j('rightEye'));
    const up = j('neck').sub(j('hips'));
    const tilt = j('spine').sub(j('hips'));
    const knee = j('leftLowerLeg');
    const ankle = j('leftFoot');
    const shank = knee.clone().sub(ankle);
    this.samples.push({
      t,
      yaw,
      speed: Math.hypot(h.gait.velocity.x, h.gait.velocity.z),
      ahead: h.gait.velocity.x * fwd.x + h.gait.velocity.z * fwd.z,
      hips: j('hips'),
      chest: j('chest'),
      head: eyesOf(h),
      pelvisRoll: pelvis.roll,
      pelvisYaw: pelvis.yaw,
      thoraxRoll: thorax.roll,
      thoraxYaw: thorax.yaw,
      lean: Math.atan2(up.dot(left), up.y),
      headRoll: head.roll,
      headYaw: head.yaw,
      planted: [h.feet[0].phase === 'planted', h.feet[1].phase === 'planted'],
      arm: sagittal(j('leftLowerArm').sub(j('leftUpperArm')), fwd),
      thigh: sagittal(j('rightLowerLeg').sub(j('rightUpperLeg')), fwd),
      trunk: Math.atan2(up.dot(fwd), up.y),
      pelvis: Math.atan2(tilt.dot(fwd), tilt.y),
      knee: Math.PI - j('leftUpperLeg').sub(knee).angleTo(ankle.clone().sub(knee)),
      ankle: shank.angleTo(j('leftToes').sub(ankle)),
    });
    this.cached = null;
  }

  get strides(): Stride[] {
    this.cached ??= this.measure();
    return this.cached;
  }

  private measure(): Stride[] {
    const S = this.samples;
    // left touch-downs
    const downs: number[] = [];
    for (let k = 1; k < S.length; k++) if (S[k].planted[0] && !S[k - 1].planted[0]) downs.push(k);
    const out: Stride[] = [];
    for (let i = 0; i + 1 < downs.length; i++) {
      const a = downs[i];
      const b = downs[i + 1];
      const n = b - a;
      if (a - n < 0 || b + n > S.length) continue;
      const speeds = S.slice(a, b).map((s) => s.speed);
      const mean = speeds.reduce((x, y) => x + y, 0) / n;
      if (mean < MIN_SPEED || speeds.some((v) => Math.abs(v - mean) > STEADY * mean)) continue;
      if (S.slice(a, b).reduce((x, s) => x + s.ahead, 0) / n < FORWARD * mean) continue;
      if (S.slice(a - n, b).some((s) => s.trunk > STOOPED)) continue;
      const turn = Math.abs(S[b].yaw - S[a].yaw) / (S[b].t - S[a].t);
      out.push(this.stride(a, b, turn > CURVE, mean));
    }
    return out;
  }

  private stride(a: number, b: number, curve: boolean, speed: number): Stride {
    const S = this.samples;
    const n = b - a;
    const half = Math.floor(n / 2);
    /** lateral offset of a point from its moving average over one stride, in the heading frame */
    const lateral = (get: (s: Sample) => Vector3) => {
      const out: number[] = [];
      for (let k = a; k < b; k++) {
        const mean = new Vector3();
        for (let q = k - half; q < k - half + n; q++) mean.add(get(S[q]));
        mean.divideScalar(n);
        out.push(get(S[k]).clone().sub(mean).dot(leftOf(S[k].yaw)));
      }
      return out;
    };
    const pl = centred(lateral((s) => s.hips));
    const cl = centred(lateral((s) => s.chest));
    const hl = centred(lateral((s) => s.head));
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const amp = (f: (s: Sample) => number) => (range(S.slice(a, b).map(f)) / 2) * DEG;
    const ys = S.slice(a, b).map((s) => s.hips.y);
    // jerk: third differences at the sampling rate
    const dt = (S[b].t - S[a].t) / n;
    let jerk = 0;
    for (let k = 3; k < cl.length; k++) jerk += ((cl[k] - 3 * cl[k - 1] + 3 * cl[k - 2] - cl[k - 3]) / dt ** 3) ** 2;
    // the thorax against the pelvis (relative yaw), and its correlation with the pelvis's
    const pr = S.slice(a, b).map((s) => s.pelvisYaw);
    const tr = S.slice(a, b).map((s) => s.thoraxYaw - s.pelvisYaw);
    // phase: where the pelvis is at each foot's mid-stance (the other's mid-swing)
    let phase = 0;
    let phases = 0;
    let bob = 0;
    const lateralAmp = range(pl) / 2 || 1;
    const upAmp = range(ys) / 2 || 1;
    const yMean = ys.reduce((x, y) => x + y, 0) / n;
    for (let side = 0; side < 2; side++) {
      const other = 1 - side;
      // the other foot's swings (it may lift before the stride begins: a running flight)
      // whose middle falls inside this stride
      for (let down = a + 1; down < b + n; down++) {
        if (!(S[down].planted[other] && !S[down - 1].planted[other])) continue;
        let lift = down - 1;
        while (lift > 0 && !S[lift - 1].planted[other]) lift--;
        const mid = Math.round((lift + down) / 2) - a;
        if (mid < 0 || mid >= n) continue;
        phase += (pl[mid] * (side === 0 ? 1 : -1)) / lateralAmp;
        bob += (ys[mid] - yMean) / upAmp;
        phases++;
      }
    }
    const arm = S.slice(a, b).map((s) => s.arm);
    const thigh = S.slice(a, b).map((s) => s.thigh);
    let best = -2;
    let lag = 0;
    const q = Math.floor(n / 2);
    for (let k = -q; k <= q; k++) {
      const shifted = S.slice(a + k, b + k).map((s) => s.arm);
      const c = correlation(shifted, thigh);
      if (c > best) {
        best = c;
        lag = k / n;
      }
    }
    // the left foot's lift-off (it touched down at a, lands again at b)
    let lift = a + 1;
    while (lift < b && S[lift].planted[0]) lift++;
    const near = S.slice(a, b).filter((s) => Math.abs(s.t - S[lift].t) < 0.1);
    const thoraxYaw = S.slice(a, b).map((s) => s.thoraxYaw);
    const fit = sineFit(arm);
    const dt2 = ((S[b].t - S[a].t) / n) ** 2;
    let acc = 0;
    for (let k = a + 1; k < b; k++) acc = Math.max(acc, Math.abs(S[k + 1].arm - 2 * S[k].arm + S[k - 1].arm) / dt2);
    return {
      from: S[a].t,
      to: S[b].t,
      armFit: fit.r2,
      armTurns: turns(S.slice(a - half, b + half).map((s) => s.arm * DEG), half, half + n),
      armAcceleration: acc / (fit.amplitude * ((2 * Math.PI) / (S[b].t - S[a].t)) ** 2),
      rollWithYaw: correlation(
        S.slice(a, b).map((s) => s.thoraxRoll),
        thoraxYaw,
      ),
      headCarry: range(S.slice(a, b).map((s) => s.headYaw)) / range(thoraxYaw),
      nod: amp((s) => s.trunk),
      pushOff: (Math.max(...near.map((s) => s.ankle)) - Math.min(...S.slice(a, lift).map((s) => s.ankle))) * DEG,
      lateKnee: S[Math.round(lift + 0.75 * (b - lift))].knee * DEG,
      armCorrelation: correlation(arm, thigh),
      armLag: lag,
      armCycles: crossings(arm) / 2,
      armRange: range(arm) * DEG,
      curve,
      speed,
      pelvisLat: range(pl),
      chestLat: range(cl),
      headLat: range(hl),
      pelvisUp: range(ys),
      obliquity: amp((s) => s.pelvisRoll),
      rotation: amp((s) => s.pelvisYaw),
      thoraxToPelvisRoll: amp((s) => s.thoraxRoll - s.pelvisRoll),
      lean: amp((s) => s.lean),
      thoraxToPelvisYaw: amp((s) => s.thoraxYaw - s.pelvisYaw),
      headRoll: amp((s) => s.headRoll),
      headYaw: amp((s) => s.headYaw),
      counter: correlation(pr, tr),
      chestJerk: Math.sqrt(jerk / Math.max(1, cl.length - 3)),
      pelvisResidual: residual(pl),
      chestResidual: residual(cl),
      phase: phases ? phase / phases : 0,
      bobPhase: phases ? bob / phases : 0,
    };
  }

  /**
   * How fast the trunk and pelvis pitch (peak °/s) through the steady strides, setting off
   * (from TRANSITION before the first step until the first steady stride) and stopping (from
   * the last steady stride until TRANSITION after the body came to rest) — null without steady strides.
   */
  rates(): { steady: Rates; start: Rates; stop: Rates } | null {
    const S = this.samples;
    const strides = this.strides;
    if (!strides.length) return null;
    const moving = S.flatMap((s, k) => (s.speed > 0.05 ? [k] : []));
    const at = (t: number) => S.findIndex((s) => s.t >= t);
    const first = strides[0];
    const last = strides[strides.length - 1];
    const peak = (a: number, b: number): Rates => {
      const out = { trunk: 0, pelvis: 0 };
      for (let k = Math.max(1, a); k < Math.min(b, S.length); k++) {
        const dt = S[k].t - S[k - 1].t;
        out.trunk = Math.max(out.trunk, (Math.abs(S[k].trunk - S[k - 1].trunk) / dt) * DEG);
        out.pelvis = Math.max(out.pelvis, (Math.abs(S[k].pelvis - S[k - 1].pelvis) / dt) * DEG);
      }
      return out;
    };
    const steady = strides.map((s) => peak(at(s.from), at(s.to)));
    return {
      steady: { trunk: Math.max(...steady.map((r) => r.trunk)), pelvis: Math.max(...steady.map((r) => r.pelvis)) },
      start: peak(at(S[moving[0]].t - TRANSITION), at(first.from)),
      stop: peak(at(last.to), at(S[moving[moving.length - 1]].t + TRANSITION)),
    };
  }

  /** the median of each measure over the straight / curved, walking / running steady strides */
  summary(curve: boolean, run: boolean): Stride | null {
    const xs = this.strides.filter((s) => s.curve === curve && s.speed > RUNNING === run);
    if (!xs.length) return null;
    const med = (f: (s: Stride) => number) => {
      const v = xs.map(f).sort((p, q) => p - q);
      return v[Math.floor(v.length / 2)];
    };
    const keys = Object.keys(xs[0]).filter((k) => k !== 'curve' && k !== 'from' && k !== 'to') as (keyof Omit<Stride, 'curve' | 'from' | 'to'>)[];
    const out = { curve } as Stride;
    for (const k of keys) out[k] = med((s) => s[k]);
    return out;
  }

  toString() {
    const lines: string[] = [];
    for (const [curve, run] of [[false, false], [false, true], [true, false], [true, true]]) {
      const s = this.summary(curve, run);
      const n = this.strides.filter((x) => x.curve === curve && x.speed > RUNNING === run).length;
      if (!s) continue;
      const cm = (m: number) => (m * 100).toFixed(1);
      lines.push(
        `gait ${curve ? 'curve   ' : 'straight'} ${run ? 'run ' : 'walk'} (${n} strides, ${s.speed.toFixed(2)} m/s): lateral p2p pelvis ${cm(s.pelvisLat)} chest ${cm(s.chestLat)} head ${cm(s.headLat)} cm, pelvis vertical ${cm(s.pelvisUp)} cm; ` +
          `± pelvis obliquity ${s.obliquity.toFixed(1)}° rotation ${s.rotation.toFixed(1)}°, thorax−pelvis roll ${s.thoraxToPelvisRoll.toFixed(1)}° yaw ${s.thoraxToPelvisYaw.toFixed(1)}° (corr ${s.counter.toFixed(2)}), trunk lean ${s.lean.toFixed(1)}°, head roll ${s.headRoll.toFixed(1)}° yaw ${s.headYaw.toFixed(1)}°; ` +
          `chest jerk ${s.chestJerk.toFixed(1)} m/s³, off-stride residual pelvis ${s.pelvisResidual.toFixed(2)} chest ${s.chestResidual.toFixed(2)}; phase: sway ${s.phase.toFixed(2)} bob ${s.bobPhase.toFixed(2)}; ` +
          `arm vs other thigh: corr ${s.armCorrelation.toFixed(2)} lag ${(s.armLag * 100).toFixed(0)}% cycles ${s.armCycles.toFixed(1)} range ${s.armRange.toFixed(0)}°; ` +
          `arm fit R² ${s.armFit.toFixed(3)} turns ${s.armTurns} peak acceleration ×${s.armAcceleration.toFixed(1)} of the sinusoid's; ` +
          `thorax roll with its rotation ${s.rollWithYaw.toFixed(2)}, head carries ${(s.headCarry * 100).toFixed(0)}% of it, trunk nod ±${s.nod.toFixed(1)}°, push-off ${s.pushOff.toFixed(0)}°, knee at 3/4 swing ${s.lateKnee.toFixed(0)}°`,
      );
    }
    const r = this.rates();
    const f = (x: Rates) => `trunk ${x.trunk.toFixed(0)} pelvis ${x.pelvis.toFixed(0)}`;
    if (r) lines.push(`pitch rates (peak °/s): steady ${f(r.steady)}, setting off ${f(r.start)}, stopping ${f(r.stop)}`);
    return lines.join('\n') || 'gait: no steady strides';
  }
}

/** `xs` less their mean (a curve offsets the path's moving average to its inside) */
const centred = (xs: number[]) => {
  const m = xs.reduce((x, y) => x + y, 0) / xs.length;
  return xs.map((x) => x - m);
};

/** the angle of `v` forward of straight down (rad) */
const sagittal = (v: Vector3, fwd: Vector3) => Math.atan2(v.dot(fwd), -v.y);

/** how often `xs` crosses its mean (one cycle crosses twice) */
function crossings(xs: number[]): number {
  const m = xs.reduce((x, y) => x + y, 0) / xs.length;
  let n = 0;
  // (as one period's worth: the last sample wraps to the first)
  for (let i = 0; i < xs.length; i++) if (Math.sign(xs[i] - m) !== Math.sign(xs[(i + 1) % xs.length] - m)) n++;
  return n;
}

/** one sinusoid at the frequency of one period of `xs` (least squares): its amplitude and share of the variance */
function sineFit(xs: number[]): { amplitude: number; r2: number } {
  const n = xs.length;
  const mean = xs.reduce((x, y) => x + y, 0) / n;
  let s = 0;
  let c = 0;
  for (let k = 0; k < n; k++) {
    s += (xs[k] - mean) * Math.sin((2 * Math.PI * k) / n);
    c += (xs[k] - mean) * Math.cos((2 * Math.PI * k) / n);
  }
  s *= 2 / n;
  c *= 2 / n;
  let rest = 0;
  let total = 0;
  for (let k = 0; k < n; k++) {
    rest += (xs[k] - mean - s * Math.sin((2 * Math.PI * k) / n) - c * Math.cos((2 * Math.PI * k) / n)) ** 2;
    total += (xs[k] - mean) ** 2;
  }
  return { amplitude: Math.hypot(s, c), r2: 1 - rest / (total || 1) };
}

/** how many times `xs` turns back (by more than 0.3: noise at a flat extreme isn't a turn) at an index in [from, to) */
function turns(xs: number[], from: number, to: number): number {
  let n = 0;
  let at = 0;
  let rising: boolean | null = null;
  for (let k = 1; k < xs.length; k++) {
    const x = xs[k];
    if (rising === null) {
      if (Math.abs(x - xs[at]) > 0.3) {
        rising = x > xs[at];
        at = k;
      }
    } else if (rising ? x > xs[at] : x < xs[at]) at = k;
    else if (Math.abs(x - xs[at]) > 0.3) {
      if (at >= from && at < to) n++;
      rising = !rising;
      at = k;
    }
  }
  return n;
}

/** Pearson correlation */
function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb || 1);
}

/** RMS of what one sinusoid at the stride frequency (over exactly one stride) leaves of `xs`, relative to that sinusoid */
function residual(xs: number[]): number {
  const n = xs.length;
  const mean = xs.reduce((x, y) => x + y, 0) / n;
  let s = 0;
  let c = 0;
  for (let k = 0; k < n; k++) {
    s += (xs[k] - mean) * Math.sin((2 * Math.PI * k) / n);
    c += (xs[k] - mean) * Math.cos((2 * Math.PI * k) / n);
  }
  s *= 2 / n;
  c *= 2 / n;
  let rest = 0;
  for (let k = 0; k < n; k++) rest += (xs[k] - mean - s * Math.sin((2 * Math.PI * k) / n) - c * Math.cos((2 * Math.PI * k) / n)) ** 2;
  const fit = Math.hypot(s, c) / Math.SQRT2;
  return Math.sqrt(rest / n) / (fit || 1);
}
