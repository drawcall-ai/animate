import { Euler, Quaternion, Vector3 } from 'three';
import type { Frame } from '../body';
import { Life, type Rhythm } from '../life';
import { clamp, GRAVITY, yawOf } from '../math';
import { Pose, type ReadonlyPose } from '../pose';
import { irregular } from '../random';
import { offsetAt, strideAt, type Gait } from './gait';
import type { LegChain } from './legs';

/**
 * How a gait carries a four-legged body (`Gait.body`), as the stride goes: with x the fore-left leg's phase from its mid-stance (rad)
 * and the wave w(c) = (1 − once) · cos(2x − c) + once · cos(x − c) — twice a stride (a walk's, a trot's: a bounce on each diagonal) or
 * once (a gallop's: `once` 1) — the withers rise `withers · w(0)` (m) and the croup `croup[0] · w(croup[1])`, the trunk pitching between
 * them; the spine pitches `spine · w(spinePhase)` (°, + its hind end up: extending); the head pitches `headPitch` (°) and rises
 * `headRise` (m) with the wave from the fore-left's landing, and rises with the withers by `headWithers` (share: 0 holds it level, as a
 * running cat's). The tail's root pitches against the croup's pitch by `tail` (share). Once a stride, with the hind legs' stance, the
 * pelvis rolls `roll` (°) and yaws `yaw` (°), and the tail swings after it. Turning, the spine bends into the turn as `bend` of the arc
 * its back (withers to croup) walks would bend it — on the spot as walking its slowest — the neck taking the front half, the spine and
 * pelvis the back (none: it does not). Running, the trunk rides its legs' push by `bounce` (share, on top of the wave): its centre of
 * mass and pitch go as each stance's push and the flights' fall carry them (`Riding`).
 */
export interface Carriage {
  bend?: number;
  withers: number;
  croup: readonly [number, number];
  spine: number;
  spinePhase: number;
  roll: number;
  yaw: number;
  headPitch: number;
  headRise: number;
  headWithers: number;
  once?: number;
  tail?: number;
  bounce?: number;
}

/**
 * What of a species' skeleton its gait carries (`Species.legs.carriage`), by bone name — the legs ordered fore-left, fore-right,
 * hind-left, hind-right; the trunk is the root — and its quiet life: rhythms named `head` (the neck turns to glance about), `weight`
 * (the spine rolls the weight over) and `tail` (each change swishes the tail `swish.cycles` times, `swish.period` s each, by
 * `swish.amplitude` rad, standing), each acted on only where it is given; other rhythms are its posture's own.
 */
export interface CarriedBones {
  spine?: string;
  pelvis?: string;
  neck?: string;
  head?: string;
  tail?: string;
  life?: readonly (readonly [string, Rhythm])[];
  swish?: { amplitude: number; period: number; cycles: number };
}

/** What a species' own posture adds to the carriage (`Carried.write`), each in the bone's terms; `weight` scales the weight roll. */
export interface Extras {
  lift?: number;
  weight?: number;
  pelvisRoll?: number;
  /** where the neck turns to (rad; default: glancing about, standing) */
  neckYaw?: number;
  headYaw?: number;
  tail?: number;
}

/**
 * The legs a carriage rides on, as it reads them: each leg's phase through its stride (0 at landing, in cycles), the root's height the
 * legs hold this sub-step if they set it (the carriage's rise and fall then only ever let it down from there), and a resting foot's tip.
 */
export interface Striding {
  readonly legs: readonly { readonly phase: number }[];
  readonly height?: number;
  /** the root's height its planted feet alone hold it at, if the legs set it: a running ride's, its flights not held down by its swinging feet */
  readonly held?: number;
  /** the stride's time and each stance's in it as the legs step them (s): the gait's, or cut short to keep within the legs' reach */
  readonly stride?: { readonly cycle: number; readonly stance: number };
  /** the root's turn (rad/s, + left), and how much further round it faces a moment on (rad, + left): what the head leads into */
  readonly turn?: { readonly rate: number; readonly ahead: number };
  /** the trunk's lean into the root's acceleration (`Inertia`: rad, + front down, + left side up), if the body leans */
  readonly lean?: { readonly pitch: number; readonly roll: number };
  rest(pitches: readonly number[]): void;
}

/** The carriage of one body, a sub-step at a time: `step` reads the stride, then `write` poses the trunk, head and tail before the legs step. */
export interface Carried {
  /** 0 standing … 1 at least at the gait's slowest pace, eased */
  readonly moving: number;
  /** the ground speed (m/s) and the fore and hind phases (rad), as `step` read them */
  readonly speed: number;
  readonly life: Life;
  step(f: Frame, legs: Striding): void;
  write(f: Frame, extras?: Extras): void;
}

/** A body's carriage over its legs `chains` (`Species.legs.carriage`; the gait's `body`), from its standing pose `start`. */
export function carriage(start: ReadonlyPose, chains: readonly LegChain[], bones: CarriedBones, gait: Gait, seed: number): Carried {
  const s = start.skeleton, index = (name?: string) => name === undefined ? undefined : s.index(name);
  const [spine, pelvis, neck, head, tail] = [bones.spine, bones.pelvis, bones.neck, bones.head, bones.tail].map(index);
  const life = new Life(seed, bones.life ?? []), names = new Set((bones.life ?? []).map(([name]) => name));
  const height = start.position(0).y, rest = new Pose(s), along = (bone: number) => rest.position(bone).z - rest.position(0).z;
  // (the withers over the fore legs' tops, the croup at the pelvis or over the hind legs' tops)
  const withersAt = along(chains[0].joints[0].bone), span = withersAt - along(pelvis ?? chains[2].joints[0].bone);
  const across = Math.max(...chains.map((chain) => Math.abs(rest.position(chain.joints[0].bone).x - rest.position(0).x)));
  const weightRoll = spine === undefined ? 0 : s.limits[spine]?.swing[0][1] ?? 0;
  const neckBase = neck === undefined ? null : s.bones[neck].offset, poll = head === undefined ? null : s.bones[head].offset;
  // (its centre of mass along the trunk, from the root, and how it takes a pitching push: its mass's spread about it, per kg)
  const masses = s.bones.map((bone, i) => [bone.mass, rest.point(i, bone.com, new Vector3())] as const), mass = masses.reduce((sum, [m]) => sum + m, 0);
  const centre = masses.reduce((sum, [m, at]) => sum.addScaledVector(at, m / mass), new Vector3()), comAt = centre.z - rest.position(0).z;
  const k2 = masses.reduce((sum, [m, at]) => sum + m * ((at.z - centre.z) ** 2 + (at.y - centre.y) ** 2), 0) / mass;
  const levers = chains.map((chain) => along(chain.joints[0].bone) - comAt), riding: Riding = { rise: new Float64Array(RIDE_SAMPLES), pitch: new Float64Array(RIDE_SAMPLES), low: 0 };
  let clock = 0;
  const swing = { angle: 0, rate: 0 }, turning = { rate: 0, ahead: 0 }, lean = { pitch: 0, roll: 0 };
  let moving = 0, speed = 0, phase = 0, hind = 0, swish = Infinity, base: number | undefined, planted: number | undefined, bent = 0, headYaw = 0;
  const body = (): Carriage => typeof gait.body === 'function' ? gait.body(speed, speed * speed / (GRAVITY * gait.height)) : gait.body ?? STILL;
  return {
    get moving() { return moving; },
    get speed() { return speed; },
    life,
    step(f, legs) {
      speed = _v.copy(f.prev.position(0)).sub(f.prev2.position(0)).setY(0).length() / f.dt;
      moving += (Math.min(1, speed / gait.slowest) - moving) * (1 - Math.exp(-4 * f.dt));
      const stride = strideAt(gait, speed, 0);
      phase = 2 * Math.PI * (legs.legs[0].phase + (speed > 0 ? stride.frequency * f.dt : 0));
      hind = 2 * Math.PI * (legs.legs[2].phase + (speed > 0 ? stride.frequency * f.dt : 0));
      swish += f.dt;
      [base, planted] = [legs.height, legs.held];
      // (the stride's clock from the fore-left's landing, and the ride it carries the trunk on at this pace)
      clock = phase / (2 * Math.PI);
      if (chains.length === 4 && (body().bounce ?? 0) > 0) {
        const stride = strideAt(gait, speed, 0);
        ride(riding, gait, speed, legs.stride ?? { cycle: 1 / stride.frequency, stance: stride.duty / stride.frequency }, levers, k2);
      }
      [turning.rate, turning.ahead] = [legs.turn?.rate ?? 0, legs.turn?.ahead ?? 0];
      [lean.pitch, lean.roll] = [legs.lean?.pitch ?? 0, legs.lean?.roll ?? 0];
      // (the spine bent into the turn — its back along the arc it walks, κ = turn / speed — as fast as `BENDING`)
      const arc = span * turning.rate / Math.max(speed, gait.slowest);
      bent += (clamp((body().bend ?? 0) * arc, -MOST_BEND, MOST_BEND) - bent) * (1 - Math.exp(-BENDING * f.dt));
      life.update(f.time, f.dt);
      if (names.has('tail') && life.fired('tail')) swish = 0;
    },
    write(f, extras = {}) {
      const m = moving, t = f.time, b = body(), once = b.once ?? 0, x = phase - Math.PI * strideAt(gait, speed, 0).duty;
      const w = (c: number) => wave(once, x, c), nod = wave(once, phase, 0);
      // Tuned: inherited drift frequencies .79/1.37/2.11 rad/s, not measured physiology.
      const drift = irregular(t, life.phase, 0.79, 1.37, 2.11) * (1 - m);
      const sway = Math.cos(hind - Math.PI * strideAt(gait, speed, 2).duty);
      // (on legs that hold the root's height, the withers rise to it at most: they only ever let it down)
      const waved = b.withers * w(0) * m - (base === undefined ? 0 : Math.abs(b.withers) * m), standing = base ?? height;
      const wavePitch = Math.asin(clamp((b.croup[0] * w(b.croup[1]) - b.withers * w(0)) / span, -1, 1)) * m;
      // (riding its legs' push: its centre of mass risen and the trunk pitched about it as the stride has them — on legs that hold the
      // root's height, from where its planted feet hold it, let down so no stance leg's top rises past it: its swinging feet reach out
      // rather than hold it down in its flights — the withers going with them)
      const rides = (b.bounce ?? 0) * m * Number(chains.length === 4), pitch = wavePitch + rides * ridden(riding.pitch, clock);
      const rise = rides * (ridden(riding.rise, clock) + (base === undefined ? 0 : (planted ?? base) - base - riding.low)) + comAt * (Math.sin(pitch) - Math.sin(wavePitch));
      const withers = waved + rise - withersAt * (Math.sin(pitch) - Math.sin(wavePitch));
      // (on legs that hold the root's height, the croup no higher than it stood either: pitched, the root lets down what it would lift it —
      // `HOLD` of its most over the stride all along, so the croup keeps nearly its whole rise and fall, the rest as it comes)
      const held = base === undefined ? 0 : HOLD * riseOver(b, m, span), croupRise = base === undefined ? 0 : held + Math.max(0, waved + span * Math.sin(wavePitch) - held);
      // (leaning into the root's acceleration, the trunk tips about the end that stays down — forward about its croup, back about its
      // withers, settling onto its haunches — and rolls about the side that does: the legs are never let out for it; the withers going
      // down with it)
      const tip = lean.pitch, pivot = tip > 0 ? withersAt - span : withersAt, sunk = (pivot - withersAt) * Math.sin(tip);
      const rolled = across * (Math.hypot(Math.sin(lean.roll), SMOOTH) - SMOOTH);
      const rootHeight = standing + waved + withersAt * Math.sin(wavePitch) + rise + pivot * Math.sin(tip) - rolled - croupRise + (extras.lift ?? 0) + 0.003 * drift;
      f.current.setRoot(_v.copy(f.current.position(0)).setY(rootHeight));
      f.current.setLocal(0, turn(pitch + tip, yawOf(f.current.rotation(0)), lean.roll));
      const glance = names.has('head') ? life.value('head') : 0, weight = names.has('weight') ? life.value('weight') : 0;
      const flex = b.spine * DEG * w(b.spinePhase) * m;
      // (bent into a turn, the hind end curls in: the spine and pelvis turned out from the trunk, sharing the bend's back half, as the neck
      // turns in)
      const curl = -bent / 2 / (spine === undefined || pelvis === undefined ? 1 : 2);
      if (spine !== undefined) f.current.setLocal(spine, turn(flex, curl, weightRoll * weight * (1 - m) * (extras.weight ?? 1)));
      if (pelvis !== undefined) f.current.setLocal(pelvis, turn(0, b.yaw * DEG * sway * m + curl, b.roll * DEG * sway * m + (extras.pelvisRoll ?? 0)));
      if (neck !== undefined && head !== undefined && neckBase && poll) {
        // Tuned (rad): a glance turns the neck .18 at most, toward ±.55 at a rate of 4/s; it leads into a turn, toward where the body will
        // face (`LEAD`), and takes the bend's front half; the head on it a share of the lead (`HEAD_LEAD`) as quickly.
        const led = clamp(turning.ahead, -LEAD, LEAD), follow = 1 - Math.exp(-4 * f.dt);
        const wanted = (extras.neckYaw ?? 0.18 * glance * (1 - m)) + led + bent / 2;
        // (its yaw as the last pose left it, read off its side axis: a reach can pitch the neck past straight down, where an Euler yaw
        // flips half a turn and the neck with it)
        const previous = yawOf(f.prev.local(neck));
        const yaw = previous + (clamp(wanted, -0.55, 0.55) - previous) * follow;
        // (the head's own turn on the neck followed as the carriage last had it: not as a reach left it)
        headYaw += ((extras.headYaw ?? 0) + HEAD_LEAD * led - headYaw) * follow;
        const base = f.current.position(neck).y;
        // (the poll kept at its standing height, rising with the withers and the stride as the gait has it, and with a lean's withers)
        const at = standing + neckBase.y + poll.y + b.headWithers * (withers + sunk) + b.headRise * nod * m;
        const neckPitch = Math.atan2(poll.y, poll.z) - Math.asin(clamp((at - base) / Math.hypot(poll.y, poll.z), -0.9, 0.9)) - pitch - tip;
        f.current.setLocal(neck, turn(neckPitch + 0.025 * drift, yaw));
        f.current.setLocal(head, turn(b.headPitch * DEG * nod * m - pitch - tip - neckPitch, headYaw));
      }
      if (tail !== undefined) {
        // Recalled: a critically damped follower, ~0.15 s lag, swinging against the pelvis's roll; seeded swishes standing.
        const sw = bones.swish;
        const roll = pelvis === undefined ? 0 : _e.setFromQuaternion(f.current.local(pelvis), 'YXZ').z;
        const goal = -2 * roll + (sw ? sw.amplitude * Math.sin(2 * Math.PI * Math.min(sw.cycles, swish / sw.period)) * Math.sign(life.aim('tail')) * (1 - m) : 0) + 0.03 * drift + (extras.tail ?? 0);
        swing.rate += (100 * (goal - swing.angle) - 20 * swing.rate) * f.dt;
        swing.angle += swing.rate * f.dt;
        f.current.setLocal(tail, turn(0.05 * m * Math.sin(2 * phase - 1) - (b.tail ?? 0) * (pitch + tip + flex), swing.angle));
      }
    },
  };
}

const DEG = Math.PI / 180;
/** how far round (rad) a roll's letting down of the root eases in, rather than turning sharply at upright */
const SMOOTH = 0.01;
/** Tuned: the most the spine bends into a turn (rad, whole), and how quickly it bends (1/s) */
const MOST_BEND = 0.5, BENDING = 6;
/**
 * The most the neck leads into a turn (rad): a person's head anticipates the way by up to ~25° (snippet: Imai et al. 2001, Exp Brain Res
 * 136:1); taken for any body's (no measure of a four-legged one's was found). Tuned: the head turns on it a share of that.
 */
const LEAD = 0.45, HEAD_LEAD = 0.3;
/** the most the croup would rise over a stride, pitched as the gait has it with the withers let down (m) */
function riseOver(b: Carriage, m: number, span: number): number {
  let most = 0;
  for (let k = 0; k < RISE_SAMPLES; k++) {
    const x = 2 * Math.PI * k / RISE_SAMPLES, w = (c: number) => wave(b.once ?? 0, x, c), withers = b.withers * w(0) * m - Math.abs(b.withers) * m;
    const pitch = Math.asin(clamp((b.croup[0] * w(b.croup[1]) - b.withers * w(0)) / span, -1, 1)) * m;
    most = Math.max(most, withers + span * Math.sin(pitch));
  }
  return most;
}
/** the carriage's wave at `x` (rad) shifted by `c` (rad): twice a stride, or `once` (share) once */
const wave = (once: number, x: number, c: number) => (1 - once) * Math.cos(2 * x - c) + once * Math.cos(x - c);
/** Tuned: the share of the croup's most rise over a stride the root is let down by all along */
const HOLD = 0.6;
/** how finely a stride is looked over for the croup's highest */
const RISE_SAMPLES = 24;
/**
 * How a running trunk rides its legs' push over a stride, as a rigid body would — the spring-mass of running, its flights ballistic:
 * each leg pushes up through its stance as a half sine [recalled: the vertical ground force of a galloping or trotting leg rises and
 * falls so, Walter & Carrier 2007, J Exp Biol 210:208; read: Hudson et al. 2012, J Exp Biol 215:2425, Fig. 5], the fore and the hind
 * pairs bearing the weight in the shares that leave the trunk no net turn over the stride (as their tops stand about its centre of mass:
 * a greyhound's fores bear 56% [read: Hudson et al. 2012]), the stride's whole push lifting its weight (∫F dt = m g T) — so between
 * pushes it falls as in flight, a push ahead of its centre of mass lifts its front and one behind it its croup, against its pitching
 * inertia `k2` (m², per kg). Its centre of mass's rise (m) and its pitch (rad, + front down) are the stride's accelerations integrated
 * twice, periodic, `RIDE_SAMPLES` to a `stride` from the fore-left's landing (`levers`: each leg's top ahead of the centre of mass, m);
 * `low` is the most a leg's top rises over the stride while its foot is down, or `EARLY` before: the root let down by it, no stance
 * leg is reached further than its legs hold it.
 */
function ride(out: Riding, gait: Gait, speed: number, stride: { cycle: number; stance: number }, levers: readonly number[], k2: number): void {
  const n = RIDE_SAMPLES, dt = stride.cycle / n, duty = stride.stance / stride.cycle, offsets = levers.map((_, i) => offsetAt(gait, speed, i));
  const fore = (levers[0] + levers[1]) / 2, hind = (levers[2] + levers[3]) / 2, foreShare = -hind / (fore - hind);
  // (how long ago in the stride leg `i` landed, at `u` cycles from the fore-left's landing)
  const since = (u: number, i: number) => (((u + offsets[0] - offsets[i]) % 1) + 1) % 1;
  const { rise, pitch } = out;
  for (let k = 0; k < n; k++) {
    let up = 0, turning = 0;
    levers.forEach((lever, i) => {
      const s = since((k + 0.5) / n, i);
      if (s >= duty) return;
      const push = (i < 2 ? foreShare : 1 - foreShare) / 2 * GRAVITY * Math.PI / (2 * duty) * Math.sin(Math.PI * s / duty);
      up += push; turning -= push * lever / k2;
    });
    [rise[k], pitch[k]] = [up - GRAVITY, turning];
  }
  // (the pushes' sum, sampled, lifting the weight just so: no drift over the stride)
  for (const a of [rise, pitch]) { const mean = a.reduce((sum, x) => sum + x, 0) / n; a.forEach((x, k) => { a[k] = x - mean; }); }
  for (const a of [rise, rise, pitch, pitch]) {
    let sum = 0, mean = 0;
    for (let k = 0; k < n; k++) { sum += a[k] * dt; a[k] = sum; mean += sum / n; }
    for (let k = 0; k < n; k++) a[k] -= mean;
  }
  out.low = -Infinity;
  for (let k = 0; k < n; k++) levers.forEach((lever, i) => {
    if (since((k + 0.5) / n + EARLY, i) < duty + EARLY) out.low = Math.max(out.low, rise[k] - lever * Math.sin(pitch[k]));
  });
}
/** Tuned: how early in a stride (cycles) a leg's landing may come and still find its top no higher than the legs hold it */
const EARLY = 0.05;
/** a stride's ride (`ride`) */
interface Riding { rise: Float64Array; pitch: Float64Array; low: number }
/** how finely a stride's ride is worked out */
const RIDE_SAMPLES = 64;
/** the ride `of` at `u` (cycles from the fore-left's landing), between its samples */
function ridden(of: Float64Array, u: number): number {
  const x = (((u * RIDE_SAMPLES - 0.5) % RIDE_SAMPLES) + RIDE_SAMPLES) % RIDE_SAMPLES, k = Math.floor(x), t = x - k;
  return of[k] + (of[(k + 1) % RIDE_SAMPLES] - of[k]) * t;
}
const STILL: Carriage = { withers: 0, croup: [0, 0], spine: 0, spinePhase: 0, roll: 0, yaw: 0, headPitch: 0, headRise: 0, headWithers: 0 };
const turn = (x = 0, y = 0, z = 0, out = _t) => out.setFromEuler(_e2.set(x, y, z, 'YXZ'));
const _t = new Quaternion(), _v = new Vector3(), _e = new Euler(), _e2 = new Euler();
