import { Vector3 } from 'three';
import { forwardOf, jointOf, leftOf } from './actor';
import { tasked, type Frame } from './frame';

/** a stride is steady when its speed varies across it, and the stride before, by less than this share of its mean (and its turn rate by less than CURVE) */
const STEADY = 0.1;
/** a stride turning faster than this (rad/s) over any stride within a stride of it is on a curve */
const CURVE = 0.15;
/** strides slower than this (m/s) aren't walking */
const MIN_SPEED = 0.6;
/** strides travelling along the facing by less than this share of their speed are side-steps or backing up, not the walk measured here */
const FORWARD = 0.8;
/** strides with the trunk flexed further than this (rad), or the stride before, are a stooped walk (or going into or out of one), not the upright gait measured here */
const STOOPED = 0.26;
/** strides with the hips lower than this share of their standing height (a crouch-walk), or rising and falling over more than `range` (m; a leap), or the stride before, are not the upright gait measured here */
const LEVEL = { low: 0.8, range: 0.15 };
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
  /** the hips' standing height (m) */
  standing: number;
  /** the chest, its offset from the hips turned back with the thorax (see `see`) */
  chest: Vector3;
  /** Shoulder-line yaw in the body's heading frame (rad). */
  thoraxYaw: number;
  /** the thorax segment's own roll and yaw (rad): across its sternoclavicular joints, not the shoulders the girdle moves on its own */
  segmentRoll: number;
  segmentYaw: number;
  lean: number;
  headRoll: number;
  headYaw: number;
  /** foot phases: planted = true */
  planted: [boolean, boolean];
  /** where the feet are planted or landing [left, right] */
  feet: [Vector3, Vector3];
  /** the script asked the eyes somewhere, or a verb has them (a grab's eyes on its grip): the head is not left to go along with the thorax */
  gazed: boolean;
  borrowedGaze: boolean;
  /** sagittal angles (+ = forward): left upper arm, right thigh — contralateral pair */
  arm: number;
  armFree: boolean;
  thigh: number;
  /** trunk (hips → neck) and pelvis (hips → spine) pitch, forward of vertical (rad) */
  trunk: number;
  pelvis: number;
  /** the left knee's flexion, and the left ankle's angle between shank and foot (rad; larger = plantarflexed) */
  knee: number;
  ankle: number;
  /** the left elbow's flexion (rad) */
  elbow: number;
  /** the body's legs over the default body's */
  legs: number;
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
  /** the stride's two step lengths' difference over their mean */
  stepAsymmetry: number;
  /** lateral peak to peak (m) */
  pelvisLat: number;
  chestLat: number;
  /** pelvis vertical peak to peak (m), and the legs' length over the default body's it rides on */
  pelvisUp: number;
  legs: number;
  /** the left foot's stance: its share of the stride (duty factor) */
  duty: number;
  /** the trunk's (hips → neck) mean forward lean over the stride (°) */
  trunkLean: number;
  /** the left elbow's least and most flexion over the stride (°; NaN: the hand held something) */
  elbowMin: number;
  elbowMax: number;
  /** angle amplitudes (half peak to peak, °) */
  lean: number;
  headRoll: number;
  /** RMS chest jerk over the RMS jerk of one sinusoid with the stride's sway (1: a pure sway; more: jerkier than its own sway) */
  chestJerkShare: number;
  /** lateral motion not explained by one sinusoid at the stride frequency, relative to it (RMS ratio) */
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
  /** the head's rotation over the thorax's (both in the heading frame): the share it goes along with (NaN: the eyes were asked somewhere) */
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

  see(frame: Frame) {
    const { t, h, asked } = frame;
    const j = (n: string) => jointOf(h, n);
    const yaw = h.locomotion.facing;
    const fwd = forwardOf(yaw);
    const left = leftOf(yaw);
    const angles = (l: Vector3, r: Vector3) => {
      const d = l.sub(r);
      const across = d.dot(left);
      return { roll: Math.atan2(d.y, across), yaw: Math.atan2(d.dot(fwd), across) };
    };
    const thorax = angles(j('leftUpperArm'), j('rightUpperArm'));
    const head = angles(j('leftEye'), j('rightEye'));
    const segment = angles(j('leftShoulder'), j('rightShoulder'));
    const eyes = j('leftEye').sub(j('rightEye'));
    // Eye-line inclination is independent of yaw, including a look behind the body.
    head.roll = Math.atan2(eyes.y, Math.hypot(eyes.x, eyes.z));
    const up = j('neck').sub(j('hips'));
    // (the trunk's lean and the chest over the hips judged in the thorax's own frontal plane: a forward-leaning trunk turned about
    // the vertical — a runner's thorax swinging with the stride — swings its chest across the heading, which is no sway nor bend)
    const across = j('leftUpperArm').sub(j('rightUpperArm')).setY(0).normalize();
    const ahead = new Vector3(-across.z, 0, across.x);
    const trunk = j('chest').sub(j('hips'));
    const chest = j('hips').addScaledVector(left, trunk.dot(across)).addScaledVector(fwd, trunk.dot(ahead)).setY(j('chest').y);
    const tilt = j('spine').sub(j('hips'));
    const knee = j('leftLowerLeg');
    const ankle = j('leftFoot');
    const shank = knee.clone().sub(ankle);
    this.samples.push({
      t,
      yaw,
      speed: Math.hypot(h.locomotion.velocity.x, h.locomotion.velocity.z),
      ahead: h.locomotion.velocity.x * fwd.x + h.locomotion.velocity.z * fwd.z,
      hips: j('hips'),
      standing: h.proportions.hipHeight,
      chest,
      thoraxYaw: thorax.yaw,
      segmentRoll: segment.roll,
      segmentYaw: segment.yaw,
      lean: Math.atan2(up.dot(across), up.y),
      headRoll: head.roll,
      headYaw: head.yaw,
      planted: [h.feet[0].phase === 'planted', h.feet[1].phase === 'planted'],
      feet: [h.feet[0].position.clone(), h.feet[1].position.clone()],
      gazed: asked.has('gaze') || !!h.body.owners.look,
      borrowedGaze: h.body.owners.look?.tier === 'borrowed',
      arm: sagittal(j('leftLowerArm').sub(j('leftUpperArm')), fwd),
      armFree: !tasked(frame, 'left'),
      thigh: sagittal(j('rightLowerLeg').sub(j('rightUpperLeg')), fwd),
      trunk: Math.atan2(up.dot(fwd), up.y),
      pelvis: Math.atan2(tilt.dot(fwd), tilt.y),
      knee: Math.PI - j('leftUpperLeg').sub(knee).angleTo(ankle.clone().sub(knee)),
      ankle: shank.angleTo(j('leftToes').sub(ankle)),
      elbow: Math.PI - j('leftUpperArm').sub(j('leftLowerArm')).angleTo(j('leftHand').sub(j('leftLowerArm'))),
      legs: h.proportions.legs,
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
      // (and the stride before it too: the first strides after setting off still settle into the rhythm)
      const speeds = S.slice(a - n, b).map((s) => s.speed);
      const mean = speeds.reduce((x, y) => x + y, 0) / speeds.length;
      if (mean < MIN_SPEED || Math.max(...speeds) - Math.min(...speeds) > STEADY * mean) continue;
      if (S.slice(a, b).reduce((x, s) => x + s.ahead, 0) / n < FORWARD * mean) continue;
      if (S.slice(a - n, b).some((s) => s.trunk > STOOPED)) continue;
      const heights = S.slice(a - n, b).map((s) => s.hips.y);
      // (approved exclusion, 2026-10-21: a crouch-walk or a leap is not the upright gait the walking references describe)
      if (Math.min(...heights) < LEVEL.low * S[a].standing || Math.max(...heights) - Math.min(...heights) > LEVEL.range) continue;
      // (turning anywhere within a stride of it, a bend setting in or easing off shifts the moving
      // averages; steady, it turns alike over it and the stride before)
      const rate = (k: number) => Math.abs(S[k + n].yaw - S[k].yaw) / (S[k + n].t - S[k].t);
      let most = 0;
      let least = Infinity;
      for (let k = a - n; k + n <= Math.min(S.length - 1, b + n); k++) [most, least] = [Math.max(most, rate(k)), Math.min(least, rate(k))];
      if (most > CURVE && most - least > CURVE) continue;
      out.push(this.stride(a, b, most > CURVE, mean));
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
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const amp = (f: (s: Sample) => number) => (range(S.slice(a, b).map(f)) / 2) * DEG;
    const headRoll = S.slice(a, b).filter((s) => !s.borrowedGaze).map((s) => s.headRoll);
    const ys = S.slice(a, b).map((s) => s.hips.y);
    // jerk: third differences at the sampling rate
    const dt = (S[b].t - S[a].t) / n;
    let jerk = 0;
    for (let k = 3; k < cl.length; k++) jerk += ((cl[k] - 3 * cl[k - 1] + 3 * cl[k - 2] - cl[k - 3]) / dt ** 3) ** 2;
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
    const free = S.slice(a, b).every((s) => s.armFree), elbows = S.slice(a, b).map((s) => s.elbow * DEG);
    const fit = sineFit(arm);
    const dt2 = ((S[b].t - S[a].t) / n) ** 2;
    let acc = 0;
    for (let k = a + 1; k < b; k++) acc = Math.max(acc, Math.abs(S[k + 1].arm - 2 * S[k].arm + S[k - 1].arm) / dt2);
    return {
      from: S[a].t,
      to: S[b].t,
      armFit: fit.r2,
      armTurns: turns(S, a, b),
      armAcceleration: acc / (fit.amplitude * ((2 * Math.PI) / (S[b].t - S[a].t)) ** 2),
      // (the thorax segment's, as motion capture's thorax is — not the shoulder line's: hands on a rifle move the shoulder girdle on
      // their own)
      rollWithYaw: correlation(
        S.slice(a, b).map((s) => s.segmentRoll),
        S.slice(a, b).map((s) => s.segmentYaw),
      ),
      headCarry: S.slice(a, b).some((s) => s.gazed) ? NaN : range(S.slice(a, b).map((s) => s.headYaw)) / range(thoraxYaw),
      nod: amp((s) => s.trunk),
      pushOff: (Math.max(...near.map((s) => s.ankle)) - Math.min(...S.slice(a, lift).map((s) => s.ankle))) * DEG,
      lateKnee: S[Math.round(lift + 0.75 * (b - lift))].knee * DEG,
      armCorrelation: correlation(arm, thigh),
      armLag: lag,
      armCycles: crossings(arm) / 2,
      // (approved exclusion, 2026-10-21: an arm whose hand holds something does not swing; the arm-swing checks judge a free one only)
      armRange: S.slice(a, b).every((s) => s.armFree) ? range(arm) * DEG : NaN,
      curve,
      speed,
      stepAsymmetry: asymmetry(S, a, b),
      pelvisLat: range(pl),
      chestLat: range(cl),
      pelvisUp: range(ys),
      legs: S[a].legs,
      duty: (lift - a) / n,
      trunkLean: (S.slice(a, b).reduce((x, s) => x + s.trunk, 0) / n) * DEG,
      elbowMin: free ? Math.min(...elbows) : NaN,
      elbowMax: free ? Math.max(...elbows) : NaN,
      lean: amp((s) => s.lean),
      // A hand task borrows gaze to find its grip; ordinary lookAt still asks for an upright head.
      // Keep the rest of a mixed stride, but one sample cannot establish an amplitude.
      headRoll: headRoll.length >= 2 ? range(headRoll) / 2 * DEG : NaN,
      // (over the RMS jerk of the stride's own sway as one sinusoid — half its peak to peak at one cycle per stride: A ω³ / √2 — so a
      // quicker or wider sway of the same shape is judged alike: jerk alone grows with the cadence cubed)
      chestJerkShare: Math.sqrt(jerk / Math.max(1, cl.length - 3)) / ((range(cl) / 2) * ((2 * Math.PI) / (S[b].t - S[a].t)) ** 3 / Math.SQRT2),
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

  /** the median of each measure over the straight / curved, walking / running steady strides (the step asymmetry: the most) */
  summary(curve: boolean, run: boolean): Stride | null {
    const xs = this.strides.filter((s) => s.curve === curve && s.speed > RUNNING === run);
    if (!xs.length) return null;
    // (a measure some strides have not, NaN, over those that have it)
    const med = (f: (s: Stride) => number) => {
      const v = xs.map(f).filter((x) => !Number.isNaN(x)).sort((p, q) => p - q);
      return v.length ? v[Math.floor(v.length / 2)] : NaN;
    };
    const keys = Object.keys(xs[0]).filter((k) => k !== 'curve' && k !== 'from' && k !== 'to') as (keyof Omit<Stride, 'curve' | 'from' | 'to'>)[];
    const out = { curve } as Stride;
    for (const k of keys) out[k] = med((s) => s[k]);
    out.stepAsymmetry = Math.max(...xs.map((s) => s.stepAsymmetry).filter((x) => !Number.isNaN(x)), 0);
    return out;
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

/** Arm reversals above 0.3° whose extrema fall in [from, to); neighbouring strides establish the trend and confirm each extremum. */
function turns(samples: Sample[], from: number, to: number): number {
  let n = 0;
  let at = Math.max(0, from - (to - from));
  let rising: boolean | null = null;
  for (let k = at + 1; k < Math.min(samples.length, to + (to - from)); k++) {
    const x = samples[k].arm * DEG;
    const peak = samples[at].arm * DEG;
    if (rising === null) {
      if (Math.abs(x - peak) > 0.3) {
        rising = x > peak;
        at = k;
      }
    } else if (rising ? x > peak : x < peak) at = k;
    else if (Math.abs(x - peak) > 0.3) {
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

/** a stride's two steps (left touch-down `a` to the right's, to the left's at `b`): how much their lengths differ, over their mean */
function asymmetry(S: Sample[], a: number, b: number): number {
  let r = a + 1;
  while (r < b && !(S[r].planted[1] && !S[r - 1].planted[1])) r++;
  if (r >= b) return NaN;
  const right = S[r].feet[1].distanceTo(S[a].feet[0]);
  const left = S[b].feet[0].distanceTo(S[r].feet[1]);
  return Math.abs(right - left) / ((right + left) / 2);
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
