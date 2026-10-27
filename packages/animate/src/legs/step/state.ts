// A stepper's state and the shapes its parts share: the root it is given, the legs it moves, the sub-step's timing and body.
import { Quaternion, Vector3 } from 'three';
import { type Frame } from '../../kernel/frame';
import type { ReadonlyPose } from '../../kernel/pose';
import { lerp, minimumJerk } from '../../kernel/math';
import { type Spot } from '../support';
import { type Gait } from '../../species/gait';

/**
 * The root the stepper steps under, a sub-step at a time: its point on the floor, its velocity over it (m/s), its facing (rad about +Y),
 * how far it crouches (0 standing … 1 a deep crouch) — a scene's — and what a planner or a walker knows more of the body over it.
 */
export interface Steering {
  position: Vector3;
  velocity: Vector3;
  yaw: number;
  crouch?: number;
  /** where the hips are over the floor from the root, if not over it (m): swaying, sitting back or leaning over the toes from it; by
   * default the hips are the root */
  hips?: Vector3;
  /** where the centre of mass is over the floor from the root, if the body keeps it there (m; a walker's: a little ahead of its feet's
   * middle, the root); by default over the root — the hips swaying about it, not the mass — the feet a crouch's `ahead` of the hips
   * as they sit back */
  com?: Vector3;
  /** how far up on the balls of its feet (m): the planted feet roll onto them as the hips rise */
  tiptoe?: number;
  /** the feet stay where they stand but to keep the balance or even out a staggered stance (a body let down or up to reach) */
  still?: boolean;
  /** the extrapolated centre of mass on the floor now, if the body knows it better than its root's (a pose's: its centre of mass carried
   * on at its speed for √(l/g)) */
  xcom?: Vector3;
  /** where it will be and face `ahead` s on, if it knows (a planner's root): a landing foresees that, not a straight run at its turning rate */
  forecast?: (ahead: number) => { position: Vector3; yaw: number };
  /** the turn (rad/s) it would make if its legs kept up, when they hold it back (a planner's): a gait's feet step to make way for it */
  turning?: number;
  /** a person's: the root at its centre of mass, the hips holding it there and the feet's middle a little behind it (a planner's); else at
   * the hips, the feet under them (a scene's) */
  centre?: boolean;
  /** a person's: whether a walk is under way on it (a planner's, from its start till it stops); none, as the body moves */
  underway?: boolean;
}

/**
 * A species' stepping, in metres of its default body (× `scale`) and seconds: each leg's place in the cycle (`offsets`, 0 … 1: a leg
 * follows the one just before it); the feet's `toeOut` (rad, × side);
 * the `cadence` (cycle 2 / (base + perSpeed v)); `duty` walking, side-stepping, running (`run`: between these speeds); the most `travel`
 * of a stance; the landing's `lead`; half the feet's spread (`width.stand` already scaled); the pelvis' `bob` and `drop`; the swing's
 * `lift` (a runner's ∝ u^`arc` (1 − u)³); the heel `strike`; the most a planted foot rolls (`pitch`, rad) and the ankle bends
 * (`dorsiflexion`); the `crouch`; the leg's `reach` (× length, a swinging leg's easing off from `swingReach`); the sole's `clearance`.
 */
export interface Stepping {
  scale: number; offsets: readonly number[]; toeOut: number; cadence: { base: number; perSpeed: number; side?: number };
  duty: { walk: number; side: number; run: number }; run: readonly [number, number]; travel: { forward: number; run: number; back: number; side: number };
  lead: { share: number; side: number; most: number; run: number }; width: { stand: number; walk: number; run: number; narrowest: number };
  bob: number; drop: { walk: number; side: number; run: number }; lift: { walk: number; run: number; jump: number }; arc: number;
  strike: { walk: number; run: number; ahead: number }; pitch: { heel: number; ball: number }; dorsiflexion: number;
  crouch: { depth: number; wider: number; ahead: number; travel: number; lift: number }; reach: number; swingReach: number; clearance: number;
  /** how far past the feet (m) the extrapolated centre of mass is caught by a step; none: the legs only follow the root (a player's) */
  capture?: number;
  /** how far the ankle plantarflexes just after the toes leave the floor (rad); none: it follows the foot */
  push?: number;
  /** the most the ankle points away from its shank (rad); none: no pointing limit */
  plantarflexion?: number;
  /** a gait whose cadence and duty the steps keep (a four-legged one's), in place of `cadence` and `duty` */
  gait?: Gait;
  /** the most the body turns from a planted foot (rad; default a person's): a leg that hardly twists steps sooner turning */
  twist?: number;
}

/**
 * A species' feet: each leg's side (+1 left) and bones, its hip's half width and the leg's lengths (m), the knee's most bend; where the
 * ankle is for a foot planted at `anchor` turned `yaw` and rolled `pitch`, the foot's turn, its sole's lowest point posed so, the shank's
 * lean over it in a pose.
 */
export interface Feet {
  /**
   * each leg's side (+1 left), its foot (and toes) and top bones; the leg across from it on its girdle (`partner`; default the one
   * before it in the gait); how far its top stands ahead of the root and out from it (m; default 0 and the hip's half width) and its home
   * ahead of it (m; default as its top), how far its
   * top joint is above the root standing (m; default 0) and the leg's length (m; default `length`)
   */
  legs: readonly {
    sign: 1 | -1; foot: number; toes?: number; top: number; partner?: number;
    ahead?: number; home?: number; hip?: number; up?: number; length?: number;
    /** how far below its top the leg reaches its foot (m) at an offset across (+ out from the body) and ahead of it (m), its joints'
     * ranges as they allow; none: a sphere of its length */
    depth?: (out: number, ahead: number, pitch?: number) => number;
    /** how far a planted foot may stray across from where it stands under its hip (m; none: a person's, inward only) */
    stray?: number;
    /** how far fore and aft together a planted foot reaches from under its hip, standing, its hip let down `drop` (m) */
    span?: (drop: number) => number;
  }[];
  hip: number; length: number; thigh: number; shin: number; ankleHeight: number;
  /** the knee's most bend (rad) */
  fold: number;
  ankle(i: number, anchor: Readonly<Vector3>, yaw: number, pitch: number, out: Vector3): Vector3;
  rotation(yaw: number, pitch: number, out: Quaternion): Quaternion;
  sole(i: number, ankle: Vector3, foot: Quaternion, toes: Quaternion): number;
  lean(i: number, pose: ReadonlyPose, yaw: number): number;
  /** the corners of the sole standing flat with its ankle at `anchor`, heading `yaw`, on the floor */
  print(i: number, anchor: Readonly<Vector3>, yaw: number): Spot[];
  /** a foot that pivots on the floor (a hoof, a paw): its ankle `anchor` standing flat turned from heading `from` to `to` about where it
   * stands, rolled `pitch`, in place */
  turnAbout?(i: number, anchor: Vector3, from: number, to: number, pitch: number): void;
}

export interface FootPose { ankle: Vector3; foot: Quaternion; toes: Quaternion; yaw: number }

export interface Leg {
  i: number; leapt?: boolean; sign: 1 | -1; anchor: Vector3; yaw: number; pitch: number; heel: boolean; free: boolean;
  planted: number; lifted: number; strike: number; landed: boolean; swing: Swing | null;
}

/** A leap under way: its phase, how long it has been in it (s), its take-off speed (m/s), and the pelvis' rise and fall over it */
export type Leap = {
  phase: 'ground' | 'launch' | 'air' | 'landed' | 'down' | 'up';
  since: number; speed: number; land: number; bottom: number; rise: number; vy: number; a: number;
};

/** The root as a sub-step reads it, and the pelvis' own rise and fall over it. */
export interface Reading {
  f: Frame;
  r: Steering;
  dt: number;
  /** its speed over the floor (m/s) and how far it runs (0 … 1) */
  v: number;
  run: number;
  /** how fast its velocity changes (m/s²) */
  accel: Vector3;
  /** how far down the legs have it crouched (0 … 1), the hips sitting back by it (m), how far up on its toes (m) */
  crouch: number;
  sitting: number;
  tiptoe: number;
  /** the pelvis' rise (m) and its speed (m/s): a leap's; in the air, the time (s) left till it lands */
  rise: number;
  vy: number;
  airborne: boolean;
  air: number;
  /** the facing it asks (rad, unwrapped near the pelvis'), its turn rate (rad/s), the turn a gait's feet step for and whether it is held back */
  wanted: number;
  spin: number;
  pressed: number;
  held: boolean;
}

/** A sub-step's stepping time: the cycle and its stance and swing (s), how far a stance travels (m) and a landing leads (s). */
export interface Timing {
  /** the speed the cadence steps for (m/s), and how much of the root's motion is sideways (−1 … 1, + to the left) */
  pacing: number;
  across: number;
  C: number;
  duty: number;
  Ts: number;
  Tsw: number;
  most: number;
  lead: number;
}

/** The body over the feet this sub-step: its facing (rad), half the feet's spread (m), how far it walks (0 … 1), its standing height (m). */
export interface Body extends Reading, Timing {
  yaw: number;
  width: number;
  moving: number;
  standing: number;
  /** where the centre of mass is over the floor from the root (m) */
  over: Vector3;
}

/** A sub-step as its phases share it: the body, and the height a landing must hold the hip at (m) and how far out each foot may land so (m). */
export interface Now extends Body {
  holding: number;
  reaches: number[];
}

/** the fewest feet a gait's body leaves on the floor */
export const STANDING = 2;
/** Derived: a gait's feet whose footfalls are within `TOGETHER` of a cycle leave the floor together (a trot's diagonals, 0.02 apart in
 * Clayton-Hobbs' offsets), the others at least that far apart (a walk's neighbours are 0.25 apart: half of that and more is clear of both) */
export const TOGETHER = 0.1;
/** Tuned: a quickened walk lets go of the turn it quickened for no faster than this (rad/s²): held back and let go by the planner sub-step
 * by sub-step, its cadence would flicker, a swing quickened mid-air slamming down */
export const SWEEPING = 4;
/**
 * Tuned: a foot steps once it is due (its gait share of a cycle after the leg before it lifted; standing, after `square` s) and is
 * `distance` (m; standing still and upright: `still`, the stance squared up evenly) off its home, or turned `turn` (rad; still: `squared`)
 * off it; at once if it would hold the pelvis `short` (m) below its height, or is `medial` (m) in from its hip under the body, or a whole
 * stance's travel behind it
 */
export const STEP = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/** Tuned: the pelvis turns at most `PELVIS_TURN` (rad) from a planted foot's facing (the trunk and gaze take the rest) */
const PELVIS_TURN = (50 * Math.PI) / 180;
/** Tuned: the pelvis turns toward its facing at most at `TURN` (rad/s², rad/s) */
export const TURN = { accel: 80, speed: 8 };
/** Tuned: slower than `SHUFFLING` (m/s), a walker's feet alternate */
export const SHUFFLING = 0.6;
/** Tuned: the heel's lift eases in over `BEND` (rad) of a lean past the ankle's bend */
const BEND = 0.15;
/** Tuned: the feet let the pelvis down at most `LOWEST` (m: a foot past reach leaves the leg straight instead) */
export const LOWEST = 0.12;
/** Tuned: past `SETTLE` of a swing even a hard stop no longer moves its landing */
export const SETTLE = 0.8;
/** Tuned: a walker's landing moves no more past `AIMED` of its swing */
export const AIMED = 0.55;
/** Tuned: the least share of the narrowest stance a foot landing well ahead of or behind the other keeps from it sideways: walking, the feet
 * pass but never cross */
export const PASSING = 0.4;

/**
 * whether a planted foot is too far in under the body from its hip (`inward`, m, + toward the body's middle): a person's more than
 * `STEP.medial`; a leg with its own `stray`, that far either way from where it stands under its hip
 */
export function strayed(st: Stepping, feet: Feet, leg: Leg, inward: number): boolean {
  const stray = feet.legs[leg.i].stray;
  if (stray === undefined) return inward > STEP.medial * st.scale;
  return Math.abs(inward - ((feet.legs[leg.i].hip ?? feet.hip) - st.width.stand)) > stray;
}

/** how far the pelvis is let down moving (× scale): walking, side-stepping, running */
export const dropOf = (st: Stepping, { across, run }: Timing & Reading) => lerp(lerp(st.drop.walk, st.drop.side, Math.abs(across)), st.drop.run, run);
/** how long a swing has left (s) */
export const remaining = (w: Swing) => (1 - w.u) * w.T;
/** `x` wrapped into a cycle (0 … 1) */
export const mod = (x: number) => ((x % 1) + 1) % 1;
/** how far `x` (rad) is past 0, easing in from `BEND`/2 before it (C¹: the heel starts lifting at rest) */
export const beyond = (x: number) => x <= -BEND / 2 ? 0 : x < BEND / 2 ? (x + BEND / 2) ** 2 / (2 * BEND) : x;
/** a planted foot's roll off its strike (rad): flat after `ROLL` */
export const rollOf = (leg: Leg) => leg.strike * (1 - minimumJerk(leg.planted / ROLL));
export const [_v, _w, _a, _b, _c, _x, _n, _hipAt, _accel, _l, _f, _m, _d, _o, _hipThen, _pivot, _centre, _over] = Array.from({ length: 18 }, () => new Vector3());
/** Tuned: a strike rolls flat in `ROLL` s */
export const ROLL = 0.1;
/** how long a gait's foot bears weight once down before it lifts again (share of a cycle) */
export const SETTLING = 0.1;

export interface Swing {
  capture: boolean; u: number; age: number; rest: number; T: number;
  x: Vector3; v: Vector3; a: Vector3; turn: { x: number; v: number; a: number };
  fromPitch: number; toes: Quaternion; strike: number; lift: number; run: number;
  rel: { x: number; v: number; a: number } | null;
}

/** What a stepper keeps from one sub-step to the next: its legs, its gait's clock and the pelvis it carries. */
export class Steps {
  readonly legs: Leg[];
  /** the pelvis' facing (rad), how far it walks and runs (0 … 1), the gait's phase (rad), the stance's and cycle's durations (s); still
   * and squared up; off the floor (a leap's flight) */
  yaw: number;
  moving = 0;
  run = 0;
  phase = 0;
  Ts = 1;
  cycle = 2;
  settled = true;
  airborne = false;
  /** the pelvis' height its planted feet alone hold it at (m): its swinging ones not holding it down — what a running body's ride is let down from */
  held = 0;
  /** how far down it is crouched (0 … 1): the root's `crouch`, eased in and out no faster than legs bend and straighten */
  crouch = 0;
  /** the pelvis turned off its facing (rad, + to the left) as the body has it with the stride: the hips the legs reach from turned with it */
  turn = 0;
  readonly crouches = [0, 0];
  /** the pelvis' turn motion, its velocity the root's turn rate this sub-step */
  readonly turning = { ...TURN, velocity: 0 };
  /** each leg's one before it in the gait and its share of a cycle after it; the leg across its girdle and its share after that */
  readonly before: number[];
  readonly gap: number[];
  readonly pair: number[];
  readonly apart: number[];
  /** the pelvis' last two facings (rad) */
  readonly yaws: number[];
  asked: number | undefined;
  stand = NaN;
  last: number;
  rootYaw: number;
  readonly jumping: Leap = { phase: 'ground', since: 0, speed: 0, land: 0, bottom: 0, rise: 0, vy: 0, a: 0 };
  low = NaN;
  most = Infinity;
  sense = 0;
  paused = 0;
  readonly hips = new Vector3();
  /** a gait's clock (cycles, 0 … 1): with a `gait`, each foot lifts in its turn as it passes the foot's offset */
  clock = 0;
  /** how many of the other feet the gait has down as each lifts */
  scheduled: number[] = [];
  /** where in the gait's cycle each foot lifts */
  lifts: number[] = [];
  /** each foot's footfall in the gait's cycle (0 … 1), as it shifts toward the gait's at its pace */
  footfalls: number[];
  /** whether each gait's foot let its turn pass held down, and steps as soon as it may */
  owed: boolean[] = [];
  /** whether a gait's cycle is under way */
  going = false;
  /** how far a gait's clock has run since it set off from standing (cycles): a foot is in its turn only for a turn that has come round
   * since, and overdue only for a stance it has stood since — standing, every foot has stood long, and the one before the first in the
   * gait is still in its turn as the clock starts */
  since = 0;
  /** the turn (rad/s) a walk's stride is quickened for: let go of no faster than `SWEEPING` (rad/s²) */
  sweeping = 0;
  /** which soles were off the floor in the last final pose `check` read */
  aloft: boolean[] | null = null;
  /** how fast (1/m … per rad) a gait's turn uses up its feet's stray: the hips' furthest from the root over the feet's narrowest sweep */
  readonly sweep: number;
  /** where the pelvis stands this sub-step, and a hip's place worked out from it: kept for `pose`, which plants feet after `move` */
  readonly pelvis = new Vector3();
  readonly hipScratch = new Vector3();
  readonly heights = [0, 0];
  readonly velocity = new Vector3();
  poses: (FootPose | null)[] = [];
  /** the last `move`'s sub-step: what `pose` plants the feet by and `reachable` re-aims their landings for */
  now: Now | undefined;

  constructor(readonly st: Stepping, readonly feet: Feet, at: readonly { position: Vector3; yaw: number }[], yaw: number) {
    this.legs = at.map((foot, i) => ({
      i, sign: feet.legs[i].sign, anchor: foot.position.clone(), yaw: foot.yaw, pitch: 0, heel: true, free: true,
      planted: 1, lifted: 1, strike: 0, landed: false, swing: null,
    }));
    // (each leg's one before it: the one whose offset comes round last before its own)
    const sooner = (o: number, p: number, best: number) => best < 0 || mod(o - p) < mod(o - st.offsets[best]);
    this.before = st.offsets.map((o, i) => st.offsets.reduce((best, p, j) => j !== i && sooner(o, p, best) ? j : best, -1));
    this.gap = st.offsets.map((o, i) => mod(o - st.offsets[this.before[i]]));
    this.pair = feet.legs.map((leg, i) => leg.partner ?? this.before[i]);
    this.apart = st.offsets.map((o, i) => mod(o - st.offsets[this.pair[i]]));
    this.yaw = this.last = this.rootYaw = yaw;
    this.yaws = [yaw, yaw];
    this.footfalls = [...st.offsets];
    const strays = feet.legs.map((leg) => leg.stray);
    const furthest = Math.max(...feet.legs.map((leg) => Math.hypot(leg.hip ?? feet.hip, leg.ahead ?? 0)));
    const sweeps = st.gait && strays.every((stray) => stray !== undefined && stray > 0);
    this.sweep = sweeps ? furthest / (2 * Math.min(...strays.map((stray) => stray ?? Infinity))) : Infinity;
  }

  /** whether the feet keep a gait's clock (a four-legged one's) */
  get clocked() { return !!this.st.gait; }

  /** the most the pelvis turns from a planted foot (rad) */
  get pelvisTurn() { return this.st.twist ?? PELVIS_TURN; }
}
