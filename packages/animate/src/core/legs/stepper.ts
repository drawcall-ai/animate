// A reactive stepper: the scene moves the root, the legs step to keep up.
// Recalled: the procedural stepping of games (e.g. Rain World, Overgrowth, Unreal "Control Rig"
// foot placement): each foot has a home under its hip; it steps when it falls too far from it,
// landing where the home will be.
import { Quaternion, Vector3 } from 'three';
import { STEP as SUB_STEP, type Frame } from '../body';
import type { ReadonlyPose } from '../pose';
import { follow } from '../follow';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, smoothstep, softMin, softplus, wrapAngle, yawOf } from '../math';
import { quintic } from './swing';
import { hullOf, outside, xcomOf, type Spot } from './support';
import { strideAt, type Gait } from './gait';

/** The root a scene drives: its point on the floor, its velocity over it (m/s), its facing (rad about +Y), how far it crouches (0 standing … 1 a deep crouch). */
export interface DrivenRoot {
  position: Vector3;
  velocity: Vector3;
  yaw: number;
  crouch?: number;
}

/** A root as the stepper takes it: a scene's (`DrivenRoot`), or the planner's and a walker's, who know more of the body over it. */
export interface RootGoal extends DrivenRoot {
  /** where the hips are over the floor from the root, if not over it (m): the root then the feet's middle under the body's centre of mass, the
   * hips swaying, sitting back or leaning over the toes from it; by default the hips are the root, the feet a crouch's `ahead` of them */
  hips?: Vector3;
  /** where the centre of mass is over the floor from the root, if the body knows (m; a walker's: a little ahead of its feet's middle);
   * by default over the hips */
  com?: Vector3;
  /** how far up on the balls of its feet (m): the planted feet roll onto them as the hips rise */
  tiptoe?: number;
  /** the feet stay where they stand but to keep the balance or even out a staggered stance (a body let down or up to reach) */
  still?: boolean;
  /** the extrapolated centre of mass on the floor now, if the body knows it better than its root's (a pose's: its centre of mass carried on at its speed for √(l/g)) */
  xcom?: Vector3;
  /** where it will be and face `ahead` s on, if it knows (a planner's root): a landing foresees that, not a straight run at its turning rate */
  forecast?: (ahead: number) => { position: Vector3; yaw: number };
  /** the turn (rad/s) it would make if its legs kept up, when they hold it back (a planner's): a gait's feet step to make way for it */
  turning?: number;
}

/**
 * A species' stepping, in metres of its default body (× `scale`) and seconds: each leg's place in the cycle (`offsets`, 0 … 1: a leg follows the one just before it); the feet's `toeOut` (rad, × side);
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
 * A species' feet: each leg's side (+1 left) and bones, its hip's half width and the leg's lengths (m), the knee's most bend; where the ankle is for a foot
 * planted at `anchor` turned `yaw` and rolled `pitch`, the foot's turn, its sole's lowest point posed so, the shank's lean over it in a pose.
 */
export interface Feet {
  /**
   * each leg's side (+1 left), its foot (and toes) and top bones; the leg across from it on its girdle (`partner`; default the one
   * before it in the gait); how far its top stands ahead of the root and out from it (m; default 0 and the hip's half width) and its home
   * ahead of it (m; default as its top), how far its
   * top joint is above the root standing (m; default 0) and the leg's length (m; default `length`)
   */
  legs: readonly { sign: 1 | -1; foot: number; toes?: number; top: number; partner?: number; ahead?: number; home?: number; hip?: number; up?: number; length?: number;
    /** how far below its top the leg reaches its foot (m) at an offset across (+ out from the body) and ahead of it (m), its joints' ranges as they allow; none: a sphere of its length */
    depth?: (out: number, ahead: number, pitch?: number) => number;
    /** how far a planted foot may stray across from where it stands under its hip (m; none: a person's, inward only) */
    stray?: number;
    /** how far fore and aft together a planted foot reaches from under its hip, standing (m) */
    span?: number }[];
  hip: number; length: number; thigh: number; shin: number; ankleHeight: number;
  /** the knee's most bend (rad) */
  fold: number;
  ankle(i: number, anchor: Readonly<Vector3>, yaw: number, pitch: number, out: Vector3): Vector3;
  rotation(yaw: number, pitch: number, out: Quaternion): Quaternion;
  sole(i: number, ankle: Vector3, foot: Quaternion, toes: Quaternion): number;
  lean(i: number, pose: ReadonlyPose, yaw: number): number;
  /** the corners of the sole standing flat with its ankle at `anchor`, heading `yaw`, on the floor */
  print(i: number, anchor: Readonly<Vector3>, yaw: number): Spot[];
  /** a foot that pivots on the floor (a hoof, a paw): its ankle `anchor` standing flat turned from heading `from` to `to` about where it stands, rolled `pitch`, in place */
  turnAbout?(i: number, anchor: Vector3, from: number, to: number, pitch: number): void;
}

export interface FootPose { ankle: Vector3; foot: Quaternion; toes: Quaternion; yaw: number }
interface Swing { capture: boolean; u: number; age: number; rest: number; T: number; x: Vector3; v: Vector3; a: Vector3; turn: { x: number; v: number; a: number }; fromPitch: number; toes: Quaternion; strike: number; lift: number; run: number; rel: { x: number; v: number; a: number } | null }
export interface Leg { i: number; leapt?: boolean; sign: 1 | -1; anchor: Vector3; yaw: number; pitch: number; heel: boolean; free: boolean; planted: number; lifted: number; strike: number; landed: boolean; swing: Swing | null }
type Leap = { phase: 'ground' | 'launch' | 'air' | 'landed' | 'down' | 'up'; since: number; speed: number; land: number; bottom: number; rise: number; vy: number; a: number };

/** Tuned: how far ahead (s) a gait's cadence takes the speed it will be going */
const PACING = 0.4;
/** Tuned: a root foreseen to move less than this (m) by a landing is all but standing */
const SETTLED_ROOT = 0.05;
/**
 * Tuned: moving, a foot lifts whatever the others do once it has stood `DUE` stances or is `DUE` stances' travel off its home. It steps once it
 * is due (its gait share of a cycle after the leg before it lifted; standing, after `square` s) and is `distance` (m; standing still and
 * upright: `still`, the stance squared up evenly) off its home, or turned `turn` (rad; still: `squared`) off it; at once if it would hold the
 * pelvis `short` (m) below its height, or is `medial` (m) in from its hip under the body, or a whole stance's travel behind it. A step that
 * would end `BLOCKED` (m) across the other foot waits for the other to step first (a walker's — a foreseen root's — instead closes beside
 * it, needing no gap from it once `SPAN` (m) or more ahead or behind; it opens a side-step with the foot on the side it goes (moving more
 * than `SIDE` of its speed sideways), lands flat but `BACKSTEP` (m) or more behind its hip, and, still, steps only to even out feet
 * `STAGGERED` (m) apart fore and aft). The pelvis turns at most `PELVIS_TURN` (rad) from a planted
 * foot's facing (the trunk and gaze take the rest), at `TURN` (rad/s², rad/s); a landing foresees at most `SPIN` (rad/s) of the root's turn;
 * turning steps as quick as walking `TURNING` m/s per rad/s turned or rad behind. A walker's pelvis never turns back past its root
 * against the way the root turns `SENSING` s on, nor for `PAUSE` s after it stops turning; slower than `SHUFFLING` (m/s), its feet alternate.
 */
const SLOT = 0.25, STANDING = 2, SETTLING = 0.1, BEHIND = 0.5, DUE = 1.5, SENSING = 0.3, PAUSE = 0.5, SHUFFLING = 0.6, BLOCKED = 0.05, SPAN = 0.25, SIDE = 0.5, BACKSTEP = 0.1, STAGGERED = 0.08, PELVIS_TURN = (50 * Math.PI) / 180, SPIN = 1.5, TURNING = 0.5, TURN = { accel: 80, speed: 8 };
const STEP = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/**
 * Tuned: a strike rolls flat in `ROLL` s; the heel's lift eases in over `BEND` (rad) of a lean past the ankle's bend; within `PIVOT` (m) of
 * being over a planted foot the hip lets it settle flat to change the end it rolls on. A root rising (getting up from a landing) asks
 * `RISING` s sooner for a foot out of reach: it steps before its leg goes straight. The feet let the pelvis down at most `LOWEST` (m: a foot
 * past reach leaves the leg straight instead), and it takes its height up again within `RISE` (m/s²); a landing is kept within the leg's
 * reach with the pelvis let down `LANDING.drop` (m) more, never nearer than `least` (m). A swing's duration grows with the gait's at most
 * `PACE` (s/s); past `SETTLE` of it even a hard stop no longer moves its landing (a walker's: past `AIMED`). Landing a leap, the foot comes down at `TOUCH` of the body's fall.
 * Recalled (Perry 1992): the push-off peaks just after toe-off, gone by mid-swing; tuned: it eases in and out over the first `PUSHED` of a swing.
 * A bend a foot lands on is read off the root's forecast `BEND_SPAN` s either side of its landing. Tuned (the old balance shuffled hip-wide
 * steps): a walker's slow step lands at most `WIDE.stances` standing stances aside of the other foot, as balance lets it (1.1: within
 * the metrics' 0.15 H for a straight stop).
 */
const ROLL = 0.1, BEND = 0.15, PIVOT = 0.03, RISING = 0.5, LOWEST = 0.12, RISE = { accel: 20 }, LANDING = { drop: 0.06, least: 0.15 }, PACE = 1, SETTLE = 0.8, AIMED = 0.55, TOUCH = 0.85, PUSHED = 0.5, BEND_SPAN = 0.1, WIDE = { stances: 1.1, within: 0.03 };
/** Tuned (shares of the crouch's depth /s², /s): how fast the legs take a crouch and rise from it — as a 0.25 s minimum-jerk crouch at its
 * peak, whatever the root asks (a crouch key pressed: a step) — so the feet keep to the floor as the pelvis drops and rises */
const CROUCHING = { accel: 90, speed: 7.5 };
/** Tuned (m/s): stepping sideways this fast, a body steps at its side-stepping cadence (slower, toward it) */
const SIDE_SPEED = 0.3;
/** Tuned: the least share of the narrowest stance a foot landing well ahead of or behind the other keeps from it sideways: walking, the feet
 * pass but never cross */
const PASSING = 0.4;
/**
 * Tuned leap: the dip and push before take-off (s; recalled: games leave the floor within ~0.1 s of
 * the press); how far below standing the feet meet the floor (m); the knees taking the landing over
 * `down` s, as deep as `depth` × the fall's speed × `down` (half that running), rising over `up` s.
 */
const JUMP = { launch: 0.1, contact: 0.02, down: 0.15, depth: 0.25, up: 0.3 };

/**
 * Legs under a root the scene drives (`move`, read every sub-step): the pelvis exactly over it,
 * facing its yaw (within a set turn of a planted foot), bobbing with the steps and let down by
 * `crouch`; each foot stays where it stands until it falls too far from its home under its hip
 * (or is turned too far from it), then steps — after the leg before it in the gait, with a flight running — to
 * where its home will be as it lands: re-aimed through the first half of the swing, frozen after;
 * heel first, rolling flat. Asked to `jump`, the legs dip, push off, follow the body's ballistic arc
 * (the root steering it over the floor) and land it, the knees taking up the fall.
 */
export class Stepper {
  readonly legs: Leg[];
  /** the pelvis' facing (rad), how far it walks and runs (0 … 1), the gait's phase (rad), the stance's and cycle's durations (s); still and squared up; off the floor (a leap's flight) */
  yaw: number; moving = 0; run = 0; phase = 0; Ts = 1; cycle = 2; settled = true; airborne = false;
  /** how far down it is crouched (0 … 1): the root's `crouch`, eased in and out no faster than legs bend and straighten */
  crouch = 0;
  /** the pelvis turned off its facing (rad, + to the left) as the body has it with the stride: the hips the legs reach from turned with it */
  turn = 0;
  private readonly crouches = [0, 0];
  /** the pelvis' turn motion, its velocity the root's turn rate this sub-step */
  private readonly turning = { ...TURN, velocity: 0 };
  private readonly before: number[]; private readonly gap: number[]; private readonly pair: number[]; private readonly apart: number[]; private readonly yaws: number[];
  private asked: number | undefined; private stand = NaN; private last: number; private rootYaw: number;
  private readonly jumping: Leap = { phase: 'ground', since: 0, speed: 0, land: 0, bottom: 0, rise: 0, vy: 0, a: 0 };
  private low = NaN; private most = Infinity; private sense = 0; private paused = 0; private readonly hips = new Vector3();
  /** a gait's clock (cycles, 0 … 1): with a `gait`, each foot lifts in its turn as it passes the foot's offset */
  private clock = 0;
  /** how many of the other feet the gait has down as each lifts */
  private scheduled: number[] = [];
  /** where in the gait's cycle each foot lifts */
  private lifts: number[] = [];
  /** whether each gait's foot let its turn pass held down, and steps as soon as it may */
  private owed: boolean[] = [];
  /** whether a gait's cycle is under way */
  private going = false;
  /** how fast (1/m … per rad) a gait's turn uses up its feet's stray: the hips' furthest from the root over the feet's narrowest sweep */
  private readonly sweep: number;
  /** where the pelvis stands this sub-step, and a hip's place worked out from it: kept for `pose`, which plants feet after `move` */
  private readonly pelvis = new Vector3(); private readonly hipScratch = new Vector3();
  private readonly heights = [0, 0]; private readonly velocity = new Vector3(); private poses: (FootPose | null)[] = [];

  constructor(private readonly st: Stepping, private readonly feet: Feet, at: readonly { position: Vector3; yaw: number }[], yaw: number) {
    this.legs = at.map((foot, i) => ({ i, sign: feet.legs[i].sign, anchor: foot.position.clone(), yaw: foot.yaw, pitch: 0, heel: true, free: true, planted: 1, lifted: 1, strike: 0, landed: false, swing: null }));
    const mod = (x: number) => ((x % 1) + 1) % 1;
    this.before = st.offsets.map((o, i) => st.offsets.reduce((best, p, j) => j !== i && (best < 0 || mod(o - p) < mod(o - st.offsets[best])) ? j : best, -1));
    this.gap = st.offsets.map((o, i) => mod(o - st.offsets[this.before[i]]));
    this.pair = feet.legs.map((leg, i) => leg.partner ?? this.before[i]);
    this.apart = st.offsets.map((o, i) => mod(o - st.offsets[this.pair[i]]));
    this.yaw = this.last = this.rootYaw = yaw;
    this.yaws = [yaw, yaw];
    const strays = feet.legs.map((leg) => leg.stray);
    this.sweep = st.gait && strays.every((stray) => stray !== undefined && stray > 0)
      ? Math.max(...feet.legs.map((leg) => Math.hypot(leg.hip ?? feet.hip, leg.ahead ?? 0))) / (2 * Math.min(...strays.map((stray) => stray ?? Infinity))) : Infinity;
  }

  /** Ask for a leap at `speed` (m/s up): taken up on the next sub-step standing or rising from a landing. */
  jump(speed: number) { this.asked = speed; }

  /** Step for this sub-step under `r` and set the root's position; the swinging feet's poses are planned now, the planted ones by `pose` once the hips are placed. */
  move(f: Frame, r: RootGoal) {
    const { st, feet, legs, jumping: jump, yaws, heights, velocity, before, pair } = this, s = st.scale, toeOut = st.toeOut, dt = f.dt, pelvisTurn = st.twist ?? PELVIS_TURN, clocked = !!st.gait;
    // (first moved: standing where it is, moving as the root already does — a body spawned on the move gets no jolt)
    if (Number.isNaN(this.stand)) { this.stand = heights[0] = heights[1] = f.prev.position(0).y; velocity.copy(r.velocity); }
    const v = Math.hypot(r.velocity.x, r.velocity.z);
    // (crouched: lower, the feet wider and a little ahead of the hips — the hips sit back — shorter, lower steps)
    const k = clamp(follow(this.crouches[0], this.crouches[1], minimumJerk(clamp(r.crouch ?? 0, 0, 1)), CROUCHING, dt), 0, 1);
    [this.crouches[0], this.crouches[1], this.crouch] = [this.crouches[1], k, k];
    const sitting = r.hips ? 0 : st.crouch.ahead * s * k, toes = Math.max(0, r.tiptoe ?? 0);
    const hips = this.hips.copy(r.hips ?? ZERO).setY(0), pelvis = this.pelvis.copy(r.position).add(hips), hipScratch = this.hipScratch;
    // (the pelvis' own rise and fall: a leap's dip, flight and landing)
    leap(jump, this.asked, smoothstep(st.run[0], st.run[1], v), s, dt);
    this.asked = undefined;
    const { rise, vy } = jump, air = jump.phase === 'air' ? Math.max(0, jump.land - jump.since) : jump.phase === 'landed' ? 0 : undefined, airborne = air !== undefined;
    this.airborne = airborne;
    // (where the root will be `ahead` s on, its speed changing as it does now: how far a hard stop or turn leaves a landing)
    const accel = _accel.subVectors(r.velocity, velocity).divideScalar(dt);
    velocity.copy(r.velocity);
    const travel = (ahead: number, out: Vector3) => r.forecast ? out.copy(r.forecast(ahead).position) : out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(accel, ahead * ahead / 2);
    // (and its velocity then: a walker's as foreseen, braking where it brakes; else run on at its acceleration)
    const pace = (ahead: number, out: Vector3) => r.forecast ? out.subVectors(r.forecast(ahead + dt).position, r.forecast(ahead).position).divideScalar(dt).setY(0) : out.copy(r.velocity).addScaledVector(accel, ahead).setY(0);
    const forward = forwardOf(yaws[1]), left = leftOf(yaws[1]);
    const run = smoothstep(st.run[0], st.run[1], v);
    const wanted = yaws[1] + wrapAngle(r.yaw - yaws[1]);
    // (the root's turn rate, to foresee its facing as a foot lands)
    const spin = clamp(wrapAngle(r.yaw - this.rootYaw) / dt, -SPIN, SPIN);
    // (a gait's feet step for the turn the body would make, held back by them: else it waits on feet that wait on it)
    const pressed = clocked && r.turning !== undefined ? clamp(r.turning, -SPIN, SPIN) : spin, held = pressed !== spin;
    this.rootYaw = r.yaw;
    // the stance's duration (quicker turning), its travel kept within reach in the direction of travel
    // (a gait's cadence as fast as it will be going by mid-stance: setting off, it steps as quickly as it is about to go, not as it stood)
    const coming = clocked && r.forecast ? Math.max(v, pace(PACING, _x).length()) : v;
    const pacing = Math.max(coming, TURNING * s * (Math.abs(pressed) + Math.abs(wanted - yaws[1]))), stride = st.gait && strideAt(st.gait, pacing, 0);
    const along = v > 1e-6 ? r.velocity.dot(forward) / v : 1, across = v > 1e-6 ? r.velocity.dot(left) / v : 0;
    // (side-stepping, quicker: short open-and-close steps rather than long straddles)
    let C = stride ? 1 / stride.frequency : 2 / (lerp(st.cadence.base, st.cadence.side ?? st.cadence.base, Math.abs(across) * smoothstep(0, SIDE_SPEED * s, v)) + st.cadence.perSpeed * pacing);
    const duty = stride ? stride.duty : lerp(lerp(st.duty.walk, st.duty.side, Math.abs(across)), st.duty.run, run);
    const most = (1 - st.crouch.travel * k) * s / Math.hypot(along / (along > 0 ? lerp(st.travel.forward, st.travel.run, run) : st.travel.back), across / st.travel.side);
    // (a stance travelling further than it may is cut short: a gait's swing keeps its time, a person's whole stride quickens)
    const swingTime = (1 - duty) * C;
    if (v * duty * C > most) C = stride ? most / v + swingTime : most / (v * duty);
    // (a gait's stance turning cut short too as its hips sweep across their feet: each foot from as far one way as it strays to as far
    // the other, the hips swinging round at the turn's rate about the root)
    if (stride && this.sweep < Infinity && Math.abs(pressed) * this.sweep * (C - swingTime) > 1) C = 1 / (Math.abs(pressed) * this.sweep) + swingTime;
    const Ts = stride ? C - swingTime : duty * C, Tsw = C - Ts;
    const lead = Math.min(lerp(st.lead.share, st.lead.side, Math.abs(across)) * Ts, (lerp(st.lead.most, st.lead.run, run) * s) / Math.max(v, 1e-6));
    // the pelvis' facing: the root's, within reach of the feet's (as they stand or will land)
    let low = -Infinity, high = Infinity;
    for (const leg of legs) {
      // (with a foreseen root, a swinging foot as it is turned now: its landing foresees the whole turn, the hips do not yet)
      const now = leg.swing && r.forecast ? leg.swing.turn.x : leg.yaw;
      const body = yaws[1] + wrapAngle(now - leg.sign * toeOut - yaws[1]);
      [low, high] = [Math.max(low, body - pelvisTurn), Math.min(high, body + pelvisTurn)];
    }
    // A biped cannot turn its pelvis through the line between its feet while the trailing foot is still leaving the floor.
    if (!clocked) for (const leg of legs) {
      const other = legs[pair[leg.i]];
      if (leg.sign < 0 || other.sign > 0) continue;
      const span = new Vector3().subVectors(f.prev.position(feet.legs[leg.i].foot), f.prev.position(feet.legs[other.i].foot)).setY(0);
      const length = span.length();
      if (length < 1e-9) continue;
      const facing = yaws[1] + wrapAngle(Math.atan2(-span.z, span.x) - yaws[1]);
      const room = Math.acos(Math.min(1, PASSING * st.width.narrowest * s / length));
      low = Math.max(low, Math.min(yaws[1], facing - room));
      high = Math.min(high, Math.max(yaws[1], facing + room));
    }
    const goal = low <= high ? clamp(wanted, low, high) : (low + high) / 2;
    const rate = Math.abs(goal - this.last) / dt < 2 * TURN.speed ? (goal - this.last) / dt : 0;
    this.last = goal;
    // (a gait's body faces as its root does: its planner turns it no faster than its feet keep up)
    let yaw = clocked ? wanted : follow(yaws[0], yaws[1], goal, (this.turning.velocity = rate, this.turning), dt);
    // (with a foreseen root: never past the feet's reach of it, braking into the limit; past it in the way the root turns, or turned
    // up to `PAUSE` s ago, never turning back: it waits for it)
    if (r.forecast && !clocked) {
      if (low <= high) yaw = clamp(yaw, low, high);
      const turning = Math.sign(wrapAngle(r.forecast(SENSING).yaw - r.yaw));
      [this.sense, this.paused] = turning !== 0 ? [turning, 0] : [this.sense, this.paused + dt];
      if (this.paused < PAUSE && (yaw - yaws[1]) * this.sense < 0 && (yaws[1] - goal) * this.sense > 0) yaw = yaws[1];
    }
    [yaws[0], yaws[1]] = [yaws[1], yaw];
    // side-stepping, the feet open wider and close in to the narrowest: their travel never crosses
    const widthAt = (speed: number) => Math.max(lerp(lerp(st.width.stand, st.width.walk * s, smoothstep(0, 1, speed)), st.width.run * s, smoothstep(st.run[0], st.run[1], speed)), (st.width.narrowest * s + Math.abs(across) * speed * Ts) / 2) + st.crouch.wider * s * k;
    const width = widthAt(v);
    const home = (leg: Leg, ahead: number, out: Vector3) => (r.forecast ? out.copy(r.forecast(ahead).position) : out.copy(r.position).addScaledVector(r.velocity, ahead)).addScaledVector(leftOf(yaw), leg.sign * width).addScaledVector(forwardOf(yaw), sitting + homeOf(leg)).setY(feet.ankleHeight);
    // the pelvis' height: let down walking, bobbing lowest after contact (running: mid-stance), as high as the feet reach
    const lengthOf = (leg: Leg) => feet.legs[leg.i].length ?? feet.length, homeOf = (leg: Leg) => feet.legs[leg.i].home ?? feet.legs[leg.i].ahead ?? 0;
    const astray = (leg: Leg, inward: number) => strayed(st, feet, leg, inward);
    const hip = (leg: Leg) => hipScratch.copy(pelvis).addScaledVector(leftOf(yaw + this.turn), leg.sign * (feet.legs[leg.i].hip ?? feet.hip)).addScaledVector(forwardOf(yaw + this.turn, _o), feet.legs[leg.i].ahead ?? 0);
    const moving = smoothstep(0, 1, v);
    const standing = this.stand - st.crouch.depth * s * k + toes;
    const nominal = () => standing + rise - (lerp(lerp(st.drop.walk, st.drop.side, Math.abs(across)), st.drop.run, run) + st.bob * lerp(1 - Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0)),
      Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / Ts)) ** 2), 0)), run)) * s * moving;
    // (a planted foot as far rolled as it may be; with the hip over it, no further than its strike's roll: there it changes ends)
    const rolled = (leg: Leg) => lerp(rollOf(leg), pivotLimit(leg), Math.max(Number(toes > 0), smoothstep(PIVOT * s, 2 * PIVOT * s, Math.abs(aheadOf(leg)))));
    const reach = (leg: Leg, given?: Vector3, pitch = 0) => {
      if (!given) pitch = rolled(leg);
      const ankle = given ?? feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
      const at = hip(leg), horizontal = Math.hypot(ankle.x - at.x, ankle.z - at.z), depth = feet.legs[leg.i].depth;
      // (its joints' own reach where they reach at all; past that, as a sphere of its length: the stray check steps it)
      const down = depth?.((ankle.x - at.x) * leftOf(yaw, _l).x * leg.sign + (ankle.z - at.z) * leftOf(yaw, _l).z * leg.sign, _o.subVectors(ankle, at).dot(forwardOf(yaw, _f)), pitch);
      if (down !== undefined && down > -Infinity) return ankle.y + down - (feet.legs[leg.i].up ?? 0);
      return ankle.y + Math.sqrt(Math.max(0, (st.reach * lengthOf(leg)) ** 2 - horizontal ** 2)) - (feet.legs[leg.i].up ?? 0);
    };
    // the furthest from under its hip a foot lands (m)
    // (the height a landing must hold the hip at, and how far out it may land so, as the legs stand before they move this sub-step)
    // A planned root can slow for a landing at its contact height; an externally driven one may need extra drop.
    const holding = r.forecast
      ? standing - (lerp(lerp(st.drop.walk, st.drop.side, Math.abs(across)), st.drop.run, run) + st.bob) * s * moving
      : Math.max(nominal() - LANDING.drop * s, standing - (LOWEST - LANDING.drop / 2) * s);
    const landingReaches = legs.map((leg) => Math.max(LANDING.least * s, Math.sqrt(Math.max(0, (st.reach * lengthOf(leg)) ** 2 - (holding + (feet.legs[leg.i].up ?? 0) - feet.ankleHeight) ** 2))));
    // (the extrapolated centre of mass `ahead` s on: the root carried on, the centre of mass where it is over it — as `r.xcom` is)
    const over = _over.copy(r.com ?? hips).setY(0);
    const xcom = (ahead: number, out: Vector3) => xcomOf(travel(ahead, out).add(over).addScaledVector(forwardOf(yaw, _f), sitting), pace(ahead, _x), feet.length, out);
    // the feet: swings on, then those too far from home lift (the furthest first)
    for (const leg of legs) {
      leg.landed = false;
      if (leg.swing) {
        const w = leg.swing;
        // (its pace kept to the gait's as the speed changes: quicker at once, slower gradually; in the air, landing as the body does)
        if (airborne) [w.rest, w.T] = [air + dt, (air + dt) / (1 - w.u)];
        else w.T = Math.min(Tsw, w.T + PACE * dt);
        w.rest = (1 - w.u) * w.T;
        w.u = Math.min(1, w.u + dt / w.T);
        w.age += dt;
        // (a walker's — a foreseen root's — landing moves no more once `AIMED` of the swing is gone: moved late, it reads as a stumble;
        // before, one that would leave the extrapolated centre of mass past the feet catches it instead)
        const settling = r.forecast ? AIMED : SETTLE;
        if (!w.capture && !airborne && st.capture !== undefined && w.u < settling) w.capture = outside(hullOf(legs.flatMap((other) => other === leg || !other.swing ? feet.print(other.i, other.anchor, other.yaw) : [])), xcom((1 - w.u) * w.T, _c)) > st.capture * s;
        // (re-aimed through the first half of the swing in time, frozen after: but for a hard stop, pulling it back into reach till late; a catch
        // as long as it may still move)
        if (airborne || (w.u < settling && (w.age < (1 - w.u) * w.T || w.capture))) [leg.anchor, leg.yaw] = landing(leg, (1 - w.u) * w.T);
        if (w.u < settling && !airborne) settle(leg, w, w.age < (1 - w.u) * w.T);
        if (w.u >= 1 - 1e-9) [leg.swing, leg.planted, leg.landed, leg.strike, leg.leapt] = [null, 0, true, w.strike, !!w.rel];
      } else {
        leg.planted += dt;
        // (a gait's planted foot that pivots turns in place about its contact as the body turns over it, heading the body's way)
        if (clocked && feet.turnAbout) {
          const to = yaw + leg.sign * toeOut;
          feet.turnAbout(leg.i, leg.anchor, leg.yaw, to, leg.pitch);
          leg.yaw = to;
        }
      }
      leg.lifted += dt;
    }
    const off = (leg: Leg, ahead: number) => home(leg, ahead, _v).sub(leg.anchor).setY(0).length();
    // (balance first: the extrapolated centre of mass — the stance's middle carried on at its speed for √(l/g), Hof — past the feet
    // standing and landing by `capture`, the foot furthest from it steps at once, to under it)
    const centre = r.xcom ? _centre.copy(r.xcom).setY(0) : xcom(0, _centre);
    const falling = !airborne && st.capture !== undefined && outside(hullOf(legs.flatMap((leg) => feet.print(leg.i, leg.anchor, leg.yaw))), centre) > st.capture * s;
    // (of the feet that may, the one that catches it without crossing the other, else the one furthest from it)
    const crossing = (leg: Leg) => Number(landing(leg, Tsw - dt)[2] > BLOCKED * s);
    const catcher = falling ? legs.filter((leg) => !leg.swing).sort((a, b) => crossing(a) - crossing(b) || b.anchor.distanceToSquared(centre) - a.anchor.distanceToSquared(centre))[0] : undefined;
    // (still and no longer turned, the feet square up closer to the facing)
    const turning = lerp(STEP.squared, STEP.turn, smoothstep(0, 0.3, v + Math.abs(spin))), turn = st.twist === undefined ? turning : Math.min(turning, st.twist / 2);
    // (moving, a foot lifts its share of a cycle after the leg before it did: the steps stay even; standing, after a moment)
    // (a gait's feet keep its order by its clock, walking or turning: each lifts within `SLOT` of a cycle after its offset comes round)
    /** how many of the other feet the gait has down as `leg` lifts: each in the air for its swing's share after its own turn comes round */
    // (each lifts its own stance after it lands: a leg whose gait has it stand shorter lifts sooner — a horse's hinds at a walk)
    if (st.gait) { const gait = st.gait; this.lifts = legs.map((leg) => st.offsets[leg.i] + (strideAt(gait, pacing, leg.i).duty - duty) * Ts / (duty * C)); }
    const scheduled = (leg: Leg) => legs.filter((other) => other !== leg && (((this.lifts[leg.i] - this.lifts[other.i]) % 1) + 1) % 1 >= Tsw / C - 1e-9).length;
    if (clocked) this.scheduled = legs.map(scheduled);
    const due = (leg: Leg) => clocked ? (((this.clock - this.lifts[leg.i]) % 1) + 1) % 1 < SLOT || this.owed[leg.i] || leg.planted >= C * DUE
      : moving > 0 ? legs[before[leg.i]].lifted >= C * this.gap[leg.i] || leg.planted >= Ts * DUE : leg.planted >= STEP.square;
    // (still, the feet stay but to even out a stance staggered fore and aft: a squat needs them side by side)
    const staggered = (leg: Leg) => Math.abs(_b.subVectors(legs[pair[leg.i]].anchor, leg.anchor).dot(forwardOf(yaw, _f))) > STAGGERED * s;
    // (a walker's foot turned toward the facing foreseen a swing on is where the body is turning, not off it: stepping it again would
    // leave the one turned behind waiting: that one steps first)
    const turningTo = r.forecast && !clocked ? r.forecast(Tsw).yaw : yaw;
    const turnedOff = (leg: Leg) => Math.abs(wrapAngle(leg.yaw - yaw - leg.sign * toeOut)) > turn && Math.abs(wrapAngle(leg.yaw - turningTo - leg.sign * toeOut)) > turn;
    // (a gait's foot steps only in its turn, having stood a while: off its home, turned off it, or overdue; out of turn, only fallen
    // `BEHIND` of a stance's travel further behind than its stance takes it from where it lands)
    const wants = (leg: Leg) => (!r.still || staggered(leg)) && (clocked ? leg.planted >= SLOT * C && ((due(leg) && (held || off(leg, lead) > (v > 0 || spin !== 0 ? STEP.distance : STEP.still) * s || turnedOff(leg))) || off(leg, lead) > (1 + BEHIND) * most)
      : (off(leg, lead) > (v > 0 || spin !== 0 || k > 0 ? STEP.distance : STEP.still) * s && due(leg)) || off(leg, lead) > Math.max(STEP.distance * s, DUE * v * Ts) || turnedOff(leg));
    // (the clock runs while the feet step or would: walking, turning, squaring up)
    // (setting off from standing, the gait's cycle starts with the foot furthest behind where it would land: it steps first)
    const underway = moving > 0 || pressed !== 0;
    if (clocked && underway && !this.going && legs.every((leg) => !leg.swing)) this.clock = this.lifts[[...legs].sort((a, b) => off(b, lead) - off(a, lead))[0].i];
    if (clocked) this.going = underway || legs.some((leg) => leg.swing);
    if (clocked && (moving > 0 || pressed !== 0 || legs.some((leg) => leg.swing || wants(leg)))) {
      // (a foot whose turn passes while it is held down still owes its step: it takes it as soon as it may, not a cycle on)
      const was = this.clock;
      this.clock = (this.clock + dt / C) % 1;
      const phase = (clock: number, leg: Leg) => (((clock - this.lifts[leg.i]) % 1) + 1) % 1;
      legs.forEach((leg) => { if (!leg.swing && phase(was, leg) < SLOT && phase(this.clock, leg) >= SLOT && leg.planted >= SLOT * C && moving > 0) this.owed[leg.i] = true; });
    }
    for (const leg of [...legs].sort((a, b) => off(b, lead) - off(a, lead))) {
      const other = legs[pair[leg.i]];
      // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
      const otherLands = other.swing ? (1 - other.swing.u) * other.swing.T : -other.planted;
      // (a foot about to be out of reach, or under the body, steps at once, the other in the air or not)
      // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
      const urgent = airborne ? !leg.swing && air > 0 : reach(leg) < nominal() + Math.max(0, vy) * RISING - STEP.short * s
        || (!leg.landed && (!other.swing || !r.forecast || clocked) && (leg === catcher || astray(leg, _v.subVectors(hip(leg), leg.anchor).dot(leftOf(yaw)) * leg.sign) || aheadOf(leg) > most));
      if (airborne && !urgent) continue;
      // (a gait's body never leaves fewer than `STANDING` feet on the floor — nor than its gait has down as this one lifts: a trot quicker
      // than half its cycle in stance has a moment in the air — one out of reach waits, the others land first)
      // (one of a pair lifting in this sub-step still counts as down: the pair leaves the floor together)
      if (clocked && !airborne && legs.filter((other) => other !== leg && (!other.swing || other.swing.age <= dt)).length < Math.min(STANDING, scheduled(leg))) continue;
      // (nor lifts a foot it has only just put down: a step lands and bears weight before the next)
      if (clocked && !leg.swing && leg.planted < SETTLING * C) continue;
      // With a planned root, touchdown bears weight before another swing; the planner can hold the root back.
      if (leg.swing || (!airborne && r.forecast && leg.landed) || !(urgent || (!leg.landed && wants(leg) && (clocked || otherLands + Ts - C * this.apart[leg.i] <= 1e-9)))) continue;
      // (a foot that would have to cross the other, or will be nearer its home than the other a swing on, lets the other step first)
      // (a walker's — a foreseen root's — closes beside the other instead: left waiting, it would trail out of reach)
      // (a walker side-stepping opens with the foot on the side it goes, the other closing after it: first it does not step away from its way)
      if (!urgent && !other.swing && r.forecast && v > 0 && across * leg.sign < -SIDE && leg.lifted <= other.lifted) continue;
      // (a walker's foot that stepped last, slow, lets the other turn first if it is turned off: the feet alternate, turning on the spot)
      if (!urgent && !other.swing && r.forecast && v < SHUFFLING && leg.lifted < other.lifted && !other.landed && turnedOff(other)) continue;
      // (a gait's feet keep its order: none waits on the one across its girdle)
      if (!urgent && !clocked && !other.swing && !airborne && ((!r.forecast && landing(leg, Tsw - dt)[2] > BLOCKED * s) || (off(other, lead + Tsw) > off(leg, lead + Tsw) + STEP.distance * s && !(r.forecast && turnedOff(leg))))) continue;
      const bone = feet.legs[leg.i].foot;
      const x = f.prev.position(bone).clone(), velocity = x.clone().sub(f.prev2.position(bone)).divideScalar(dt);
      const toesBone = feet.legs[leg.i].toes, toes = toesBone === undefined ? new Quaternion() : f.prev.local(toesBone).clone();
      const T = airborne ? air + dt : Tsw;
      this.owed[leg.i] = false;
      leg.swing = { capture: leg === catcher, u: dt / T, age: dt, rest: T, T, x, v: velocity, a: new Vector3(), turn: { x: leg.yaw, v: wrapAngle(yawOf(f.prev.rotation(bone)) - yawOf(f.prev2.rotation(bone))) / dt, a: 0 }, fromPitch: leg.pitch, toes, strike: 0,
        lift: (airborne ? st.lift.jump : lerp(st.lift.walk, st.lift.run, run) * (1 - st.crouch.lift * k)) * s, run, rel: null };
      [leg.anchor, leg.yaw] = landing(leg, T - dt);
      settle(leg, leg.swing);
      this.phase = 2 * Math.PI * st.offsets[leg.i];
      leg.lifted = 0;
    }
    /** a landing kept within reach of the hip as it will be (a hard stop pulls it in), heel first only ahead of it */
    function settle(leg: Leg, w: Swing, aiming = true) {
      const remaining = (1 - w.u) * w.T, through = travel(remaining, _v).add(hips);
      const hipAt = (facing: number, root: Vector3, out: Vector3) => out.copy(root).addScaledVector(leftOf(facing, _l), leg.sign * (feet.legs[leg.i].hip ?? feet.hip)).addScaledVector(forwardOf(facing, _o), feet.legs[leg.i].ahead ?? 0);
      const at = hipAt(yaw, through, _hipThen), out = _b.subVectors(leg.anchor, at).setY(0);
      const depth = feet.legs[leg.i].depth;
      if (depth) {
        // (a leg whose joints reach less than a sphere's: its landing pulled in as far as they hold the hip at its height — a gait's hip
        // anywhere between where the body is and faces now and where it is foreseen to as the foot lands: a long body's hips swing
        // round off its turning centre, and its root, all but standing, goes on only as far as its legs keep up)
        const need = holding + (feet.legs[leg.i].up ?? 0) - feet.ankleHeight, then = r.forecast ? r.forecast(remaining).yaw : yaw + spin * remaining;
        const now = _w.copy(r.position).add(hips);
        const from = (facing: number, root: Vector3, k: number) => {
          const d = _x.copy(at).addScaledVector(out, k).sub(hipAt(facing, root, _c));
          return depth(d.dot(leftOf(facing, _l)) * leg.sign, d.dot(forwardOf(facing, _f))) >= need;
        };
        // (where the root is now only for a body all but standing: one on its way is where it goes)
        const still = now.distanceTo(through) < SETTLED_ROOT * s;
        const reaches = (k: number) => from(yaw, through, k) && (!clocked || (from(then, through, k) && (!still || (from(yaw, now, k) && from(then, now, k)))));
        if (!reaches(1)) {
          let [lo, hi] = [0, 1];
          for (let n = 0; n < 12; n++) [lo, hi] = reaches((lo + hi) / 2) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
          // (its landing within reach before it is clear of the other foot: a gait's feet may pass close, not out of reach)
          leg.anchor.copy(at).addScaledVector(out, lo).setY(feet.ankleHeight);
        }
      } else if (out.length() > landingReaches[leg.i]) uncross(leg, leg.anchor.copy(at).add(out.setLength(landingReaches[leg.i])).setY(feet.ankleHeight), leftOf(leg.yaw - leg.sign * toeOut, _l));
      // (a walker's — a foreseen root's — foot landing just behind its hip, squaring up, lands flat: toes first only stepping back)
      const ahead = out.dot(forwardOf(leg.yaw)), aim = r.forecast && ahead < 0 ? Math.min(0, ahead + BACKSTEP * s) : ahead;
      if (!aiming) return;
      w.strike = lerp(st.strike.walk, st.strike.run, run) * clamp(aim / (st.strike.ahead * s), -1, 1);
      // (re-aimed to the gait as it goes now — a run eased to a walk — it swings as that gait's: no higher, its arc's peak no later)
      if (w.run > run) [w.lift, w.run] = [w.lift * lerp(st.lift.walk, st.lift.run, run) / lerp(st.lift.walk, st.lift.run, w.run), run];
    }
    function landing(leg: Leg, remaining: number): [Vector3, number, number] {
      // turned toward the root's facing, as far as the other foot lets the pelvis
      const other = legs[pair[leg.i]];
      const body = other.yaw - other.sign * toeOut;
      // (where the root will be and face as it lands, foreseen: as it says, or running on as it turns)
      // (a gait's foot lands as the root goes now, not as its forecast hopes: the legs of a long body hold it back more than a person's)
      const then = clocked ? undefined : r.forecast?.(remaining + lead), ahead = then ? wanted + wrapAngle(then.yaw - wanted) : wanted + spin * (remaining + lead);
      // (a gait's foot lands under its hip for the body turned as it is turning now, on to the middle of its stance: one ahead of or
      // behind the root swings out with the turn, from one side of where it stands to the other)
      // (the foot itself heading the body's way as it lands: it pivots on the floor as the body comes round over it)
      const turned = clocked ? yaws[1] + spin * (remaining + Ts / 2) : other.swing ? ahead : body + clamp(wrapAngle(ahead - body), -pelvisTurn, pelvisTurn);
      const footing = clocked ? yaws[1] + spin * remaining : turned;
      const side = leftOf(turned, new Vector3());
      // (as wide as the speed it will land at: a stopping step lands in the standing stance)
      const landed = pace(remaining, _w), speed = landed.dot(r.velocity) > 0 ? Math.hypot(landed.x, landed.z) : 0;
      // (along the way it will go, round its curve, but as far as it goes now: a stop is caught by a foot further on — ahead only: one
      // stopping a step aside or back lands where the body stops, beside it)
      const chord = then ? _c.subVectors(then.position, r.position).setY(0) : null, far = Math.max(chord?.length() ?? 0, v * (remaining + lead));
      const on = chord && chord.lengthSq() > 1e-12 ? _n.copy(chord).multiplyScalar(far / chord.length() - 1) : null;
      const to = (chord && on ? new Vector3().copy(r.position).add(chord).addScaledVector(forwardOf(turned, _f), Math.max(0, on.dot(forwardOf(turned, _f)))) : new Vector3().copy(r.position).addScaledVector(r.velocity, remaining + lead))
        .addScaledVector(side, leg.sign * widthAt(speed)).addScaledVector(forwardOf(turned, _f), sitting + homeOf(leg)).setY(feet.ankleHeight);
      // (rounding a bend the body leans in: the feet land out from its way as far as the extrapolated centre of mass runs out from it — its
      // speed × turn rate (the sideways acceleration) × l/g, halved: Hof's √(l/g) ahead along the tangent, off the arc by its square over twice the radius)
      if (then) {
        const t = remaining + lead, before = r.forecast!(Math.max(0, t - BEND_SPAN)).position, after = r.forecast!(t + BEND_SPAN).position;
        const turn = wrapAngle(Math.atan2(after.x - then.position.x, after.z - then.position.z) - Math.atan2(then.position.x - before.x, then.position.z - before.z));
        to.addScaledVector(leftOf(Math.atan2(after.x - before.x, after.z - before.z), _n), -((after.distanceTo(before) / (2 * BEND_SPAN)) ** 2) * turn / BEND_SPAN * feet.length / GRAVITY / 2);
      }
      // (a walker's step whose landing would leave the extrapolated centre of mass as it will be past the feet lands under it instead, just
      // to its side; and no further from it as it is now than the other foot and it hold it: a first step is a short one)
      const capture = st.capture;
      if (capture !== undefined && !airborne) {
        const yawed = turned + leg.sign * toeOut, others = other.swing ? [] : feet.print(other.i, other.anchor, other.yaw);
        const past = (at: Vector3, centre: Vector3) => outside(hullOf([...feet.print(leg.i, at, yawed), ...others]), centre) > capture * s;
        const centre = xcom(remaining, new Vector3()), under = (c: Vector3) => c.clone().addScaledVector(side, leg.sign * st.width.narrowest * s / 2).setY(feet.ankleHeight);
        const now = r.xcom;
        // (a walker's slow step lands no further aside of the other foot than `WIDE.stances`, its extrapolated centre of mass, as it will be
        // and is, kept within `WIDE.within` of the feet: it shuffles rather than straddles)
        const gap = _v.subVectors(to, other.anchor).dot(side) * leg.sign, most = WIDE.stances * 2 * st.width.stand;
        if (r.forecast && !other.swing && speed < SHUFFLING * s && gap > most) {
          const narrower = to.clone().addScaledVector(side, -leg.sign * (gap - most));
          const within = (c: Vector3) => outside(hullOf([...feet.print(leg.i, narrower, yawed), ...others]), c) <= WIDE.within * s;
          if (within(centre) && (!now || within(now))) to.copy(narrower);
        }
        if (past(to, centre)) to.copy(under(centre));
        if (now && !other.swing && past(to, now)) {
          const from = to.clone(), toward = under(now);
          let [lo, hi] = [0, 1];
          for (let k = 0; k < 12; k++) [lo, hi] = past(_n.lerpVectors(from, toward, (lo + hi) / 2), now) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
          to.lerpVectors(from, toward, hi);
        }
      }
      return [to, footing + leg.sign * toeOut, uncross(leg, to, side)];
    }
    /** `to` moved onto its own side of the other foot, as the body will face (`side`, its left) and as it faces now; how far it was across (m) */
    function uncross(leg: Leg, to: Vector3, side: Vector3): number {
      const other = legs[pair[leg.i]];
      let across = 0;
      for (const axis of [side, leftOf(yaw, _m)]) {
        // (with a foreseen root, a foot landing a foot's length or more ahead of or behind the other need not land a full stance beside it:
        // the shanks pass apart — but never across the line between them: `PASSING` of the stance kept)
        const along = Math.abs(_v.subVectors(to, other.anchor).dot(_n.set(-axis.z, 0, axis.x))), apart = r.forecast ? lerp(PASSING, 1, 1 - smoothstep(SPAN * s, 2 * SPAN * s, along)) : 1;
        const gap = _v.dot(axis) * leg.sign, narrowest = st.width.narrowest * s * apart;
        if (gap < narrowest) to.addScaledVector(axis, leg.sign * (narrowest - gap));
        across = Math.max(across, narrowest - gap);
      }
      return across;
    }
    // the swinging ankles on their paths, the pelvis as high as the feet let it (in the air: where the root has it)
    // (in the air the pelvis' own height eases back up to the gait's, the root's rise on it)
    // (heights kept as if standing up: the crouch's own smooth lowering and raising is followed at once)
    const crouched = st.crouch.depth * s * k;
    // (followed up toward `to` within `RISE`, braking as it comes: it arrives without a jolt, and a fall is turned back up within it too)
    const lifted = (to: number) => follow(heights[0], heights[1], to + crouched, RISE, dt) - crouched;
    const flying = lifted(nominal() - rise);
    this.poses = legs.map((leg) => leg.swing ? swingPose(leg, leg.swing) : null);
    let y = airborne ? flying + rise : nominal();
    // (a swinging foot holds the pelvis down only late in its swing: before, its leg just swings straighter)
    if (!airborne) legs.forEach((leg, i) => { y = softMin(y, reach(leg, this.poses[i]?.ankle) + (leg.swing ? LOWEST * s * (1 - minimumJerk((leg.swing.u - 0.5) / 0.3)) : 0), 0.004 * s); });
    // (let down at once as the feet need, up again within `RISE`: a foot let go of does not pop the pelvis up)
    // (the root's own rise and fall are followed at once)
    // (and, crouching too, no lower than a leg folds, as it stood last: its knee bent its most, a planted foot would slide, a swinging
    // one would be held into the floor — deep in a crouch a step lifts the hips as it lifts the foot)
    const folded = Math.sqrt(feet.thigh ** 2 + feet.shin ** 2 + 2 * feet.thigh * feet.shin * Math.cos(feet.fold));
    const fold = Math.max(-Infinity, ...legs.map((leg, i) => {
      const ankle = this.poses[i]?.ankle ?? feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), at = hip(leg);
      return ankle.y + Math.sqrt(Math.max(0, folded ** 2 - (ankle.x - at.x) ** 2 - (ankle.z - at.z) ** 2));
    }));
    const want = Math.max(y - rise, standing - LOWEST * s);
    const base = airborne ? flying : Math.max(Math.min(want, lifted(want)), fold - rise);
    [heights[0], heights[1]] = [heights[1], base + crouched];
    y = base + rise;
    f.current.setRoot(_v.copy(pelvis).setY(y));
    const stepping = legs.some((leg) => leg.swing);
    this.phase += Math.PI * dt / (C / 2) * Number(stepping);
    [this.yaw, this.moving, this.run, this.Ts, this.cycle] = [yaw, moving, run, Ts, C];
    this.settled = !(v > 0.05 || stepping) && legs.every((leg) => leg.planted > 0.4) && legs.every((leg) => !wants(leg));
    this.plant = (leg, at) => plantedPose(leg, at);
    [this.low, this.most] = [standing - (st.bob + STEP.short) * s, most];

    /** a swinging foot: minimum jerk toward its landing (heel strike), the lift arc over it, clear of the floor */
    function swingPose(leg: Leg, w: Swing): FootPose {
      const { foot: footBone, toes: toesBone, top } = feet.legs[leg.i];
      if (airborne && !w.rel) {
        // (taking to the air mid-step, the step starts over as the leap's, from where the foot is, moving as it does)
        const at = f.prev.position(footBone), was = f.prev2.position(footBone), hips = f.prev.position(0), hipsWas = f.prev2.position(0);
        w.rel = { x: hips.y - at.y, v: (hips.y - at.y - hipsWas.y + was.y) / dt, a: 0 };
        w.x.set(at.x - hips.x, at.y, at.z - hips.z);
        w.v.set(at.x - was.x - hips.x + hipsWas.x, at.y - was.y, at.z - was.z - hips.z + hipsWas.z).divideScalar(dt);
        w.a.set(0, 0, 0);
        [w.fromPitch, w.u, w.T, w.age, w.lift, w.run] = [leg.pitch, dt / w.rest, w.rest, dt, st.lift.jump * s, 0];
        if (toesBone !== undefined) w.toes.copy(f.prev.local(toesBone));
      }
      const u = w.u;
      // (landing as it will stand: heel up already where the shank will lean past the ankle's bend, the hips as low as they are going)
      const hipLands = _hipAt.copy(hip(leg)).addScaledVector(r.velocity, w.rest).setY(f.prev.position(top).y + Math.min(0, f.prev.position(top).y - f.prev2.position(top).y) / dt * w.rest);
      const strike = w.strike - beyond(shankLean(hipLands, feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _a), leg.yaw) + w.strike - st.dorsiflexion) * minimumJerk((u - 0.5) / 0.5);
      const land = feet.ankle(leg.i, leg.anchor, leg.yaw, strike, new Vector3());
      if (airborne) for (const axis of ['x', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis] - pelvis[axis] - r.velocity[axis] * air, -r.velocity[axis], w.rest, dt);
      else for (const axis of ['x', 'y', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis], 0, w.rest, dt);
      // Retarget the turn with its current velocity and acceleration, just like the ankle's position.
      [w.turn.x, w.turn.v, w.turn.a] = quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, w.rest, dt);
      const yawNow = w.turn.x;
      leg.pitch = w.fromPitch * (1 - minimumJerk(u / 0.45)) + strike * minimumJerk((u - 0.6) / 0.4);
      const lean = feet.lean(leg.i, f.prev, yawNow);
      // (walking, pushed off: the ankle plantarflexed most just after the toes leave the floor, in line again by mid-swing)
      if (st.push && !airborne) leg.pitch = Math.min(leg.pitch, lerp(leg.pitch, Math.max(st.pitch.ball, -st.push - lean), moving * Math.sin(Math.PI * Math.min(1, u / PUSHED)) ** 2));
      // (its own shank's lean bends the ankle early in the swing; landing, the strike already stands as it will)
      leg.pitch -= beyond(lean + leg.pitch - st.dorsiflexion) * (1 - minimumJerk((u - 0.6) / 0.4));
      if (st.plantarflexion !== undefined) leg.pitch = Math.max(leg.pitch, -st.plantarflexion - lean);
      const foot = feet.rotation(yawNow, leg.pitch, new Quaternion());
      // (the toes relax off the floor into line, and landing toes first come down flat)
      const toes = foot.clone().multiply(_q.copy(w.toes).slerp(IDENTITY, minimumJerk(u / 0.3)))
        .slerp(feet.rotation(yawNow, Math.max(0, leg.pitch), _toes), minimumJerk((u - 0.6) / 0.4));
      // (the arc peaks mid-swing walking; a runner's heel stays up later, the knee bent late into the swing; a gait's as its `arc` has it)
      const a = st.gait ? st.arc : lerp(3, st.arc, w.run), peak = a / (a + 3);
      const arc = w.lift * (u ** a * (1 - u) ** 3) / (peak ** a * (1 - peak) ** 3);
      const ankle = w.x.clone().setY(w.x.y + arc);
      if (airborne) {
        // (in the air the leg's length is planned, not the foot's height: hanging from the hips, tucked
        // between; landing, the foot comes down with the body, slowed a little by the knees bending)
        const rel = w.rel;
        if (!rel) throw new Error('a swing in the air without its leap');
        const pelvisY = flying + rise, falls = rise + vy * air - GRAVITY * air * air / 2;
        [rel.x, rel.v, rel.a] = quintic(rel.x, rel.v, rel.a, flying + falls - land.y, (1 - TOUCH) * (vy - GRAVITY * air), w.rest, dt);
        ankle.set(pelvis.x + w.x.x, pelvisY - rel.x + arc, pelvis.z + w.x.z);
      }
      const lowest = feet.sole(leg.i, ankle, foot, toes);
      const soft = 0.004 * Math.sin(Math.PI * u) ** 2 + Number.EPSILON;
      ankle.y += softplus(st.clearance * s * Math.sin(Math.PI * u) ** 3 - lowest, soft);
      return { ankle, foot, toes, yaw: yawNow };
    }
    /** a planted foot: rolling flat off its heel strike, onto its heel or ball as far as the hip needs to reach it */
    function plantedPose(leg: Leg, at: Vector3): FootPose {
      // (from the roll off the heel strike, on toward the pivot that brings the ankle nearer)
      const roll = rollOf(leg);
      const depth = feet.legs[leg.i].depth;
      const far = (pitch: number) => {
        const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a);
        if (!depth) return ankle.distanceTo(at) > st.reach * lengthOf(leg);
        // (a leg whose joints reach less than a sphere's: as far as they hold its top where it is)
        const d = _b.subVectors(ankle, at);
        return depth(d.dot(leftOf(yaw, _l)) * leg.sign, d.dot(forwardOf(yaw, _f)), pitch) < -d.y;
      };
      leg.free = !far(roll);
      let lo = roll, hi = leg.free ? roll : pivotLimit(leg);
      for (let k = 0; k < 24 && hi !== roll; k++) { const mid = (lo + hi) / 2; if (far(mid)) lo = mid; else hi = mid; }
      leg.pitch = hi;
      // (the heel lifts once the shank leans further over the foot than the ankle bends: deep in a crouch)
      leg.pitch -= beyond(shankLean(at, feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), leg.yaw) + leg.pitch - st.dorsiflexion);
      leg.pitch = pointed(leg, leg.pitch, at);
      const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, new Vector3());
      return { ankle, foot: feet.rotation(leg.yaw, leg.pitch, new Quaternion()), toes: feet.rotation(leg.yaw, Math.max(0, leg.pitch), new Quaternion()), yaw: leg.yaw };
    }
    /** the most a planted foot rolls to help the hip reach it: onto its heel when it is ahead, its ball when behind */
    function pivotLimit(leg: Leg): number {
      // (it changes ends only while it needs no roll past its strike's: changed mid-roll, the roll would jump)
      if (leg.free) leg.heel = toes === 0 && aheadOf(leg) < 0;
      // (just landed, it first rolls off its strike: the pivot is given over as the roll ends)
      return pointed(leg, lerp(rollOf(leg), leg.heel ? st.pitch.heel : st.pitch.ball, minimumJerk(leg.planted / ROLL)));
    }
    function pointed(leg: Leg, pitch: number, at?: Vector3): number {
      if (st.plantarflexion === undefined) return pitch;
      const lean = at ? shankLean(at, feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a), leg.yaw) : feet.lean(leg.i, f.prev, leg.yaw);
      return Math.max(pitch, -st.plantarflexion - lean);
    }
    function aheadOf(leg: Leg): number {
      return _v.subVectors(hip(leg), leg.anchor).dot(forwardOf(leg.yaw));
    }
    /** how far the shank leans forward over a foot heading `yaw` with the hip at `hip` and the ankle at `ankle`, the knee bent toward the toes (rad) */
    function shankLean(hip: Vector3, ankle: Vector3, yaw: number): number {
      const along = _b.subVectors(ankle, hip), l = along.length();
      along.divideScalar(l);
      const a = (feet.thigh ** 2 - feet.shin ** 2 + l * l) / (2 * l), rise = Math.sqrt(Math.max(0, feet.thigh ** 2 - a * a));
      const fw = forwardOf(yaw, _f), side = _m.copy(fw).addScaledVector(along, -fw.dot(along)).normalize();
      const shin = _l.copy(hip).addScaledVector(along, a).addScaledVector(side, rise).sub(ankle);
      return Math.atan2(shin.dot(fw), shin.y);
    }
  }

  /**
   * Whether the legs keep up with a root that goes as `forecast` has it (its floor point and facing `ahead` s on), as they now stand: each
   * planted foot within its leg's reach — the pelvis let down all it may, the foot rolled as far as it may — until it may next lift (the
   * other foot down), and turned from it no further than the pelvis turns; each swing past re-aiming lands within reach of its hip.
   * Reads the last `move`; changes nothing.
   */
  reachable(forecast: (ahead: number) => { position: Vector3; yaw: number }): boolean {
    const { st, feet, legs, pair } = this;
    if (Number.isNaN(this.low)) return true;
    const within = (leg: Leg, ahead: number, pitches: readonly number[]) => {
      const at = forecast(ahead), hip = _w.copy(at.position).add(this.hips).addScaledVector(leftOf(at.yaw, _m), leg.sign * (feet.legs[leg.i].hip ?? feet.hip)).addScaledVector(forwardOf(at.yaw, _o), feet.legs[leg.i].ahead ?? 0).setY(0);
      // (and turned no further from a planted foot than the pelvis may — a gait's pivots in place on the floor as far as the body turns
      // — the hip not in over it nor a stance's travel past it)
      if (!st.gait && !leg.swing && Math.abs(wrapAngle(at.yaw - leg.yaw + leg.sign * st.toeOut)) > (st.twist ?? PELVIS_TURN)) return false;
      if (!leg.swing && (strayed(st, feet, leg, _b.subVectors(hip, leg.anchor).dot(leftOf(at.yaw, _l)) * leg.sign) || _b.subVectors(hip, leg.anchor).dot(forwardOf(leg.yaw, _f)) > this.most)) return false;
      // (a gait's planted foot that pivots will have turned in place with the body by then)
      const pivots = !leg.swing && st.gait && feet.turnAbout, anchor = pivots ? _pivot.copy(leg.anchor) : leg.anchor, yaw = pivots ? at.yaw + leg.sign * st.toeOut : leg.yaw;
      return pitches.some((pitch) => {
        if (pivots) feet.turnAbout!(leg.i, anchor.copy(leg.anchor), leg.yaw, yaw, pitch);
        const ankle = feet.ankle(leg.i, anchor, yaw, pitch, _a);
        const most = st.reach * (feet.legs[leg.i].length ?? feet.length), depth = feet.legs[leg.i].depth;
        if (depth) return depth(_n.subVectors(ankle, hip).dot(leftOf(at.yaw, _l)) * leg.sign, _n.dot(forwardOf(at.yaw, _f)), pitch) >= this.low + (feet.legs[leg.i].up ?? 0) - ankle.y;
        return Math.hypot(ankle.x - hip.x, ankle.z - hip.z) ** 2 + Math.max(0, this.low + (feet.legs[leg.i].up ?? 0) - ankle.y) ** 2 <= most * most;
      });
    };
    // (balance first: a walker's extrapolated centre of mass kept within the feet as they stand and land — no further past them than it is)
    if (st.capture !== undefined && legs.some((leg) => leg.swing)) {
      const support = hullOf(legs.flatMap((leg) => feet.print(leg.i, leg.anchor, leg.yaw)));
      const xcom = (t: number) => { const at = forecast(t).position; return xcomOf(at, _c.subVectors(forecast(t + SUB_STEP).position, at).divideScalar(SUB_STEP), feet.length, _x); };
      const allowed = Math.max(st.capture * st.scale, outside(support, xcom(0))), rest = Math.max(...legs.map((leg) => leg.swing ? (1 - leg.swing.u) * leg.swing.T : 0));
      for (let t = rest / 4; t <= rest + 1e-9; t += rest / 4) if (outside(support, xcom(t)) > allowed + 1e-6) return false;
    }
    return legs.every((leg) => {
      const w = leg.swing;
      if (w) {
        // (turned no further from a swinging foot, as it turns on to its landing, than the pelvis may: nor further than it is already)
        const turned = (t: number) => Math.abs(wrapAngle(forecast(t).yaw - quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, (1 - w.u) * w.T, t)[0] + leg.sign * st.toeOut));
        const allowed = Math.max(st.twist ?? PELVIS_TURN, turned(0)), rest = (1 - w.u) * w.T;
        for (let t = rest / 4; t <= rest + 1e-9; t += rest / 4) if (turned(t) > allowed + 1e-6) return false;
        // (a gait's landing, frozen once aimed, is kept within reach from then on: its body's forecast may turn out slower)
        return w.u < (st.gait ? AIMED : SETTLE) || within(leg, rest, [0]);
      }
      // (a gait's foot may next lift once the others in the air have landed, or as its turn comes round if the gait has it leave the floor
      // before they do: it holds till then)
      const other = legs[pair[leg.i]].swing, landed = Math.max(0, ...legs.map((l) => l.swing ? (1 - l.swing.u) * l.swing.T : 0));
      // (and, turning on the spot, till its own turn comes round: before then it stays)
      const own = (((this.lifts[leg.i] - this.clock) % 1) + 1) % 1 * this.cycle;
      const wait = st.gait ? Math.max(Math.min(landed, this.scheduled[leg.i] < STANDING ? own : Infinity), this.moving > 0.05 ? 0 : own) : other ? (1 - other.u) * other.T : 0;
      for (let t = 0; t <= wait + 1e-9; t += Math.max(1 / 60, wait / 6)) if (!within(leg, t, [0, st.pitch.heel, st.pitch.ball])) return false;
      return true;
    });
  }

  private plant: (leg: Leg, at: Vector3) => FootPose = () => { throw new Error('pose before move'); };

  /** Leg `i`'s foot posed for this sub-step with its top joint at `top` (as the hips now stand); a swinging leg is never asked past its reach, where the knee's swivel is undefined. */
  pose(i: number, top: Vector3): FootPose {
    const leg = this.legs[i], st = this.st, length = this.feet.legs[i].length ?? this.feet.length;
    const pose = this.poses[i] ?? this.plant(leg, top);
    const d = _d.subVectors(pose.ankle, top), l = d.length(), from = st.swingReach * length, span = (st.reach - st.swingReach) * length;
    if (leg.swing && l > from) pose.ankle.lerp(_a.copy(top).addScaledVector(d, (from + span * Math.tanh((l - from) / span)) / l), this.airborne ? 1 : 1 - minimumJerk((leg.swing.u - 0.8) / 0.15));
    return pose;
  }
}

/** A leap asked (`asked`, its take-off speed) moved on `dt`: dipping, then in the air (landing on a sub-step), the knees taking it, rising again (`run`: 0 … 1 running; `s`: the body's scale). */
function leap(j: Leap, asked: number | undefined, run: number, s: number, dt: number) {
  if (asked !== undefined && (j.phase === 'ground' || j.phase === 'up')) [j.phase, j.since, j.speed] = ['launch', 0, asked];
  j.since += dt;
  if (j.phase === 'landed') [j.phase, j.since, j.bottom, j.a] = ['down', dt, j.rise + JUMP.depth * (1 - run / 2) * j.vy * JUMP.down, -GRAVITY];
  if (j.phase === 'launch') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, 0, j.speed, JUMP.launch - j.since + dt, dt);
    if (j.since >= JUMP.launch - 1e-9) [j.phase, j.since, j.land] = ['air', 0, Math.ceil((j.speed + Math.sqrt(j.speed ** 2 + 2 * GRAVITY * JUMP.contact * s)) / GRAVITY / dt - 1e-6) * dt];
  } else if (j.phase === 'air') {
    const t = Math.min(j.since, j.land);
    [j.rise, j.vy] = [j.speed * t - GRAVITY * t * t / 2, j.speed - GRAVITY * t];
    if (j.since >= j.land - 1e-9) j.phase = 'landed';
  } else if (j.phase === 'down') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, j.bottom, 0, JUMP.down - j.since + dt, dt);
    if (j.since >= JUMP.down - 1e-9) [j.phase, j.since] = ['up', 0];
  } else if (j.phase === 'up') {
    [j.rise, j.vy, j.a] = quintic(j.rise, j.vy, j.a, 0, 0, JUMP.up - j.since + dt, dt);
    if (j.since >= JUMP.up - 1e-9) [j.phase, j.rise, j.vy, j.a] = ['ground', 0, 0, 0];
  }
}

/**
 * whether a planted foot is too far in under the body from its hip (`inward`, m, + toward the body's middle): a person's more than
 * `STEP.medial`; a leg with its own `stray`, that far either way from where it stands under its hip
 */
function strayed(st: Stepping, feet: Feet, leg: Leg, inward: number): boolean {
  const stray = feet.legs[leg.i].stray;
  if (stray === undefined) return inward > STEP.medial * st.scale;
  return Math.abs(inward - ((feet.legs[leg.i].hip ?? feet.hip) - st.width.stand)) > stray;
}

/** how far `x` (rad) is past 0, easing in from `BEND`/2 before it (C¹: the heel starts lifting at rest) */
const beyond = (x: number) => x <= -BEND / 2 ? 0 : x < BEND / 2 ? (x + BEND / 2) ** 2 / (2 * BEND) : x;

/** a planted foot's roll off its strike (rad): flat after `ROLL` */
const rollOf = (leg: Leg) => leg.strike * (1 - minimumJerk(leg.planted / ROLL));

const ZERO = new Vector3();
const IDENTITY = new Quaternion(), _q = new Quaternion(), _toes = new Quaternion();
const _centre = new Vector3(), _over = new Vector3();
const [_v, _w, _a, _b, _c, _x, _n, _hipAt, _accel, _l, _f, _m, _d, _o, _hipThen, _pivot] = Array.from({ length: 16 }, () => new Vector3());
