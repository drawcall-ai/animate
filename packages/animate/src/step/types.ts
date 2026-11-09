// What the steps read and keep: the root steering them, a species' stepping and feet, a leg and its swing, and a sub-step's reading.
import type { Object3D, Quaternion, Vector3 } from 'three';
import type { ReadonlyBonePose } from '../kernel/bone-pose';
import type { Frame } from '../kernel/frame';
import type { Gait } from '../species/gait';
import type { Spot } from './support';

/**
 * The root the stepper steps under, a sub-step at a time: its point on the floor, its velocity over it (m/s), its facing (rad about +Y),
 * how far it crouches (0 standing … 1 a deep crouch) — a scene's — and what a planner or a walker knows more of the body over it.
 */
export interface Steering {
  position: Vector3; velocity: Vector3; yaw: number; crouch?: number;
  /** Physics contact on the supporting surface, null in flight, absent when animation owns movement. */
  support?: Vector3 | null;
  /** The object whose motion carries the supported root, when it moves (`Root.platform`). */
  platform?: Object3D;
  /** Physics' vertical speed; velocity stays horizontal for gait and foot placement. */
  vertical?: number;
  /** where the hips are over the floor from the root, if not over it (m): swaying, sitting back or leaning over the toes from it; by
   * default the hips are the root */
  hips?: Vector3;
  /** how far the pelvis is shifted over the floor standing: its weight onto a foot, or going off another to lift it (m, past `hips`): placed
   * so, the legs reaching from it, but stepping as from where it would be without it — a moment's */
  shifted?: Vector3;
  /** where the centre of mass is over the floor from the root, if the body keeps it there (m; a walker's: a little ahead of its feet's
   * middle, the root); by default over the root — the hips swaying about it, not the mass — the feet a crouch's `ahead` of the hips
   * as they sit back */
  com?: Vector3;
  /** how far up on the balls of its feet (m): the planted feet roll onto them as the hips rise */
  tiptoe?: number;
  /** each foot's home put this far ahead of where it stands (m, by leg): a foot off it steps there (a throw's stride) */
  stagger?: readonly number[];
  /** the feet stay where they stand but to keep the balance or even out a staggered stance (a body let down or up to reach) */
  still?: boolean;
  /** its weight on a seat: no foot lifts, however far its hips are from them */
  seated?: boolean;
  /** the extrapolated centre of mass on the floor now, if the body knows it better than its root's (a pose's: its centre of mass carried
   * on at its speed for √(l/g)) */
  xcom?: Vector3;
  /** where it will be and face `ahead` s on, to read without changing it: a landing foresees that, not a straight run at its turning rate */
  forecast?: (ahead: number) => { position: Vector3; yaw: number };
  /** how it would be going, its turn (rad/s) and velocity (m/s), if its legs kept up, when they hold it back (a planner's): a gait's feet step to make way for it */
  wanted?: { angular: number; velocity: Vector3 };
  /** a person's: whether a walk is under way on it (a planner's, from its start till it stops); none, as the body moves */
  underway?: boolean;
  /** a walker's: its walk ends on a still goal it comes to rest on (its closing step lands where the body can stop over it); not one it
   * follows, which may move off again any moment */
  arriving?: boolean;
}
/**
 * A species' stepping, in metres of its default body (× `scale`) and seconds: each leg's place in the cycle (`offsets`, 0 … 1: a leg
 * follows the one just before it); the feet's `toeOut` (rad, × side); the speeds it runs between (`run`); the most `travel` of a stance; the landing's
 * `landAhead`; half the feet's spread (`width.stand` already scaled; `width.sway`: how far toward a walker's landing foot, past the midline, its
 * extrapolated centre of mass is carried — a wider stride's, its pelvis swaying over it); the pelvis' `bob` and `drop`; the swing's
 * `lift` (a runner's ∝ u^`arc` (1 − u)³); the heel `strike`; the
 * most a planted foot rolls (`pitch`, rad) and the ankle bends (`dorsiflexion`); the `crouch`; the leg's `reach` (× length, a swinging
 * leg's easing off from `swingReach`); the sole's `clearance`.
 */
interface SteppingOf {
  scale: number; offsets: readonly number[]; toeOut: number; run: readonly [number, number]; travel: { forward: number; run: number; back: number; side: number };
  landAhead: { share: number; side: number; most: number; run: number }; width: { stand: number; walk: number; run: number; narrowest: number; sway?: number };
  bob: number; drop: { walk: number; side: number; run: number }; lift: { walk: number; run: number; jump: number }; arc: number;
  strike: { walk: number; run: number; ahead: number }; pitch: { heel: number; ball: number }; dorsiflexion: number;
  crouch: { depth: number; wider: number; ahead: number; travel: number; lift: number }; reach: number; swingReach: number; clearance: number;
  /** how far past the feet (m) the extrapolated centre of mass is caught by a step; none: the legs only follow the root (a player's) */
  capture?: number;
  /** how far the ankle plantarflexes just after the toes leave the floor (rad); none: it follows the foot */
  push?: number;
  /** the most the ankle points away from its shank (rad); none: no pointing limit */
  plantarflexion?: number;
  /** the most the body turns from a planted foot (rad; default a person's): a leg that hardly twists steps sooner turning */
  twist?: number;
}
/** A person's stepping: the `cadence` (cycles a second at a pace, m/s, a share of it sideways, 0 … 1, and the body's time, s) and `duty` walking, side-stepping, running. */
export interface CadencedStepping extends SteppingOf {
  cadence: (speed: number, sideways: number, time: number) => number;
  duty: { walk: number; side: number; run: number };
  gait?: undefined;
}
/** A four-legged stepping: a `gait` whose cycle and duty the steps keep, on its clock. */
export interface GaitStepping extends SteppingOf { gait: Gait }
export type Stepping = CadencedStepping | GaitStepping;
/**
 * A species' feet: each leg's side (+1 left) and bones, its hip's half width and the leg's lengths (m), the knee's most bend; where the
 * ankle is for a foot planted at `anchor` turned `yaw` and rolled `pitch`, the foot's turn, its sole's points posed so, the shank's
 * lean over it in a pose.
 */
export interface Feet {
  /**
   * each leg's side (+1 left), its foot (and toes) and top bones; the leg across from it on its girdle (`partner`; default the one
   * before it in the gait); how far its top stands ahead of the root and out from it (m; default 0 and the hip's half width) and its home
   * ahead of it (m; default under it, not under its top: a walker's root settles over where its feet land, so a home off it, a hip set ahead or
   * carried off it by a bow, walks the body away a step at a time), how far its top joint is above the root standing (m; default 0) and the leg's length (m; default `length`)
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
  /** the points of its sole (its heel and toes) with its ankle at `ankle`, the foot and toes turned so (world) */
  soles(i: number, ankle: Readonly<Vector3>, foot: Quaternion, toes: Quaternion): Vector3[];
  lean(i: number, pose: ReadonlyBonePose, yaw: number): number;
  /** the corners of the sole standing flat with its ankle at `anchor`, heading `yaw`, on the floor */
  print(i: number, anchor: Readonly<Vector3>, yaw: number): Spot[];
  /** a foot that pivots on the floor (a hoof, a paw): its ankle `anchor` standing flat turned from heading `from` to `to` about where it
   * stands, rolled `pitch`, in place */
  turnAbout?(i: number, anchor: Vector3, from: number, to: number, pitch: number): void;
}
export interface FootPose { ankle: Vector3; foot: Quaternion; toes: Quaternion; yaw: number }
export interface Leg {
  i: number;
  /** its foot is coming down, or came down, from a flight (a leap, or a fall physics ended): its landing is fixed, it does not push off,
   * and it does not lift again until it has landed; cleared when it next lifts */
  leapt?: boolean;
  sign: 1 | -1; anchor: Vector3; yaw: number; pitch: number; heel: boolean; free: boolean;
  planted: number; lifted: number; strike: number; landed: boolean; swing: Swing | null;
  /** the way a planted foot headed as it began to pivot (rad; `Steps.pivots`); none: it has not since it landed */
  pivot?: number;
  /** The planted foot or swing landing, in its own platform's frame. */
  on?: { platform?: Object3D; anchor: Vector3; yaw: number };
}
/** A leap under way: its phase, how long it has been in it (s), its take-off speed (m/s), and the pelvis' rise and fall over it */
export type Leap = {
  phase: 'ground' | 'launch' | 'air' | 'landed' | 'down' | 'up';
  since: number; speed: number; land: number; bottom: number; rise: number; vy: number; a: number;
};
/** Who moves the root this sub-step, read once off `Steering.support`: whether physics does (`physical`), and then the point it stands on
 * (`contact`) or that it is in the air (`flight`), how high over the floor (`clearance`, m); neither when the animation does. */
export interface Physics { physical: boolean; contact: Vector3 | undefined; flight: boolean; clearance: number }
/** The root as a sub-step reads it, and the pelvis' own rise and fall over it. */
export interface Reading extends Physics {
  f: Frame; r: Steering; dt: number;
  /** its speed over the floor (m/s) and how far it runs (0 … 1) */
  v: number; run: number;
  /** how fast its velocity changes (m/s²) */
  accel: Vector3;
  /** how far down the legs have it crouched (0 … 1), the hips sitting back by it (m), how far up on its toes (m) */
  crouch: number; sitting: number; tiptoe: number;
  /** the pelvis' rise (m) and its speed (m/s): a leap's; in the air, the time (s) left till it lands */
  rise: number; vy: number; airborne: boolean; air: number;
  /** the facing it asks (rad, unwrapped near the pelvis'), its turn rate (rad/s), the turn a gait's feet step for and whether it is held back */
  wanted: number; spin: number; pressed: number; held: boolean;
  /** whether its feet step for a turn quicker than a landing foresees (`pressed`): a biped's then pivot */
  spinning: boolean;
}
/** A sub-step's stepping time: the cycle and its stance and swing (s), how far a stance travels (m) and a landing leads (s). */
export interface Timing {
  /** the speed the cadence steps for (m/s), and how much of the root's motion is sideways (−1 … 1, + to the left) */
  pacing: number; across: number;
  C: number; duty: number; Ts: number; Tsw: number; most: number; landAhead: number;
}
/** The body over the feet this sub-step: its facing (rad), half the feet's spread (m), how far it walks (0 … 1), the ground under it, how
 * fast that rises (m/s) and the height its pelvis stands at over it (m, both world heights). */
export interface StepBody extends Reading, Timing {
  yaw: number; width: number; moving: number; ground: number; climb: number; standing: number;
  /** where the centre of mass is over the floor from the root (m) */
  over: Vector3;
}
/** A sub-step as its phases share it: the body, and the height a landing must hold the hip at (m) and how far out each foot may land so (m). */
export interface StepInput extends StepBody { holding: number; reaches: number[] }
export interface Swing {
  capture: boolean; u: number; age: number; rest: number; T: number;
  /** it lifted once the weight was off it: the body stands on the others through it */
  unloaded: boolean;
  /** it steps where the body stands — the root over the level it lifts from as it lands: turning, squaring — and keeps to that level, its
   * sole over the edge if it must (`foothold`'s `stays`) */
  stays: boolean;
  /** the floor's height it stood on, and how far its sole's lowest point hangs below its ankle as it has been posed (m, eased) */
  level: number; drop: number;
  x: Vector3; v: Vector3; a: Vector3; turn: { x: number; v: number; a: number };
  fromPitch: number; toes: Quaternion; strike: number; lift: number; run: number;
  rel: { x: number; v: number; a: number } | null;
  /** how far through it (u) its landing first stood below the floor it left, stepping down (NaN: not yet) */
  lowering: number;
  /** the floor's level its landing was first aimed onto (m; NaN until it is) */
  onto: number;
  /** development's support check has seen it (`checkSupport`); lifted from under a still body's weight: its landing no support till it moves */
  seen?: boolean;
  borne?: boolean;
}
