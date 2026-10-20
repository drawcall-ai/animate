import { Euler, Quaternion, Vector3 } from 'three';
import type { Frame } from '../body';
import { Life, type Rhythm } from '../life';
import { clamp, yawOf } from '../math';
import { Pose, type ReadonlyPose } from '../pose';
import { irregular } from '../random';
import { strideAt, type Gait } from './gait';
import type { LegChain } from './legs';

/**
 * How a gait carries a four-legged body (`Gait.body`), as the stride goes: with θ = 2 · the fore leg's phase − 2π · its duty, twice a
 * stride, the withers rise `withers · cos θ` (m) and the croup `croup[0] · cos(θ − croup[1])`, the trunk pitching between them; the
 * spine flexes `spine` (°) at `spinePhase` (rad); the head pitches `headPitch` (°) and rises `headRise` (m) with `cos 2·phase`, and
 * rises with the withers by `headWithers` (share). Once a stride, with the hind legs' stance, the pelvis rolls `roll` (°) and yaws
 * `yaw` (°), and the tail swings after it.
 */
export interface Carriage {
  withers: number;
  croup: readonly [number, number];
  spine: number;
  spinePhase: number;
  roll: number;
  yaw: number;
  headPitch: number;
  headRise: number;
  headWithers: number;
}

/**
 * What of a species' skeleton its gait carries (`Species.legs.carriage`), by bone name — the legs ordered fore-left, fore-right,
 * hind-left, hind-right; the trunk is the root — and its quiet life: rhythms named `head` (the neck turns to glance about), `weight`
 * (the spine rolls the weight over) and `tail` (each change swishes the tail `swish.cycles` times, `swish.period` s each, by
 * `swish.amplitude` rad, standing), each acted on only where it is given; other rhythms are the posture's own (`Carried.life`).
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
  const weightRoll = spine === undefined ? 0 : s.limits[spine]?.swing[0][1] ?? 0;
  const neckBase = neck === undefined ? null : s.bones[neck].offset, poll = head === undefined ? null : s.bones[head].offset;
  const swing = { angle: 0, rate: 0 };
  let moving = 0, speed = 0, phase = 0, hind = 0, swish = Infinity, base: number | undefined;
  const body = (): Carriage => gait.body ?? STILL;
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
      base = legs.height;
      life.update(f.time, f.dt);
      if (names.has('tail') && life.fired('tail')) swish = 0;
    },
    write(f, extras = {}) {
      const m = moving, t = f.time, b = body(), wave = Math.cos(2 * phase);
      // Tuned: inherited drift frequencies .79/1.37/2.11 rad/s, not measured physiology.
      const drift = irregular(t, life.phase, 0.79, 1.37, 2.11) * (1 - m);
      const theta = 2 * phase - 2 * Math.PI * strideAt(gait, speed, 0).duty;
      const sway = Math.cos(hind - Math.PI * strideAt(gait, speed, 2).duty);
      // (on legs that hold the root's height, the withers rise to it at most: they only ever let it down)
      const withers = b.withers * Math.cos(theta) * m - (base === undefined ? 0 : Math.abs(b.withers) * m), standing = base ?? height;
      const pitch = Math.asin((b.croup[0] * Math.cos(theta - b.croup[1]) - b.withers * Math.cos(theta)) / span) * m;
      // (on legs that hold the root's height, the croup no higher than it stood either: pitched, the root lets down what it would lift it)
      const croupRise = base === undefined ? 0 : Math.max(0, withers + span * Math.sin(pitch));
      const rootHeight = standing + withers + withersAt * Math.sin(pitch) - croupRise + (extras.lift ?? 0) + 0.003 * drift;
      f.current.setRoot(_v.copy(f.current.position(0)).setY(rootHeight));
      f.current.setLocal(0, turn(pitch, yawOf(f.current.rotation(0))));
      const glance = names.has('head') ? life.value('head') : 0, weight = names.has('weight') ? life.value('weight') : 0;
      if (spine !== undefined) f.current.setLocal(spine, turn(b.spine * DEG * Math.cos(theta - b.spinePhase) * m, 0, weightRoll * weight * (1 - m) * (extras.weight ?? 1)));
      if (pelvis !== undefined) f.current.setLocal(pelvis, turn(0, b.yaw * DEG * sway * m, b.roll * DEG * sway * m + (extras.pelvisRoll ?? 0)));
      if (neck !== undefined && head !== undefined && neckBase && poll) {
        const previous = _e.setFromQuaternion(f.prev.local(neck), 'YXZ').y;
        // Tuned (rad): a glance turns the neck .18 at most, toward ±.55 at a rate of 4/s.
        const wanted = extras.neckYaw ?? 0.18 * glance * (1 - m);
        const yaw = previous + (clamp(wanted, -0.55, 0.55) - previous) * (1 - Math.exp(-4 * f.dt));
        const base = f.current.position(neck).y;
        // (the poll kept at its standing height, rising with the withers and the stride as the gait has it)
        const at = standing + neckBase.y + poll.y + b.headWithers * withers + b.headRise * wave * m;
        const nod = Math.atan2(poll.y, poll.z) - Math.asin(clamp((at - base) / Math.hypot(poll.y, poll.z), -0.9, 0.9)) - pitch;
        f.current.setLocal(neck, turn(nod + 0.025 * drift, yaw));
        f.current.setLocal(head, turn(b.headPitch * DEG * wave * m - pitch - nod, extras.headYaw ?? 0));
      }
      if (tail !== undefined) {
        // [C] Critically damped follower, ~0.15 s lag, swinging against the pelvis's roll; seeded swishes standing.
        const sw = bones.swish;
        const roll = pelvis === undefined ? 0 : _e.setFromQuaternion(f.current.local(pelvis), 'YXZ').z;
        const goal = -2 * roll + (sw ? sw.amplitude * Math.sin(2 * Math.PI * Math.min(sw.cycles, swish / sw.period)) * Math.sign(life.aim('tail')) * (1 - m) : 0) + 0.03 * drift + (extras.tail ?? 0);
        swing.rate += (100 * (goal - swing.angle) - 20 * swing.rate) * f.dt;
        swing.angle += swing.rate * f.dt;
        f.current.setLocal(tail, turn(0.05 * m * Math.sin(2 * phase - 1), swing.angle));
      }
    },
  };
}

const DEG = Math.PI / 180;
const STILL: Carriage = { withers: 0, croup: [0, 0], spine: 0, spinePhase: 0, roll: 0, yaw: 0, headPitch: 0, headRise: 0, headWithers: 0 };
const turn = (x = 0, y = 0, z = 0, out = _t) => out.setFromEuler(_e2.set(x, y, z, 'YXZ'));
const _t = new Quaternion(), _v = new Vector3(), _e = new Euler(), _e2 = new Euler();
