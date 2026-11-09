// A stepper's state and the shapes its parts share: the root it is given, the legs it moves, the sub-step's timing and body.
import { Vector3 } from 'three';
import { wrapAngle, mod } from '../kernel/math';
import { Cadence, GaitClock } from './gait-clock';
import { hullOf, past } from './support';
import { foothold, type Floor } from './floor';
import { Ground } from './ground';
import type { Stepping, Feet, FootPose, Leg, Leap, StepInput } from './types';

/**
 * The turn (rad) from facing `from` to `to`: the short way round, but for one more than a quarter turn the other way, the `way` (±1, 0:
 * none) the root went round — spun faster than its feet let the body follow, the root came to lead it by more than half a turn, and turned
 * the short way the body went back against it; but a root spun a little past a whole turn round is not followed the long way round.
 */
export function turnTo(from: number, to: number, way: number): number {
  const turn = wrapAngle(to - from);
  return turn * way < 0 && Math.abs(turn) > Math.PI / 2 ? turn + way * 2 * Math.PI : turn;
}

/** Tuned: a root turning slower than this (rad/s) sets no way round to follow it (`Steps.way`) */
export const SPUN = 0.5;

/**
 * Tuned: a foot steps once it is due (its gait share of a cycle after the leg before it lifted; standing, after `square` s) and is
 * `distance` (m; standing still and upright: `still`, the stance squared up evenly) off its home, or turned `turn` (rad; still: `squared`)
 * off it; at once if it would hold the pelvis `short` (m) below its height, or is `medial` (m) in from its hip under the body, or a whole
 * stance's travel behind it
 */
export const THRESHOLDS = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/** Tuned: how long every foot stands planted, none wanting a step, before the legs are settled (s) */
export const SETTLED_AFTER = 0.4;
/** Tuned: the pelvis turns at most `PELVIS_TURN` (rad) from a planted foot's facing (the trunk and gaze take the rest) */
const PELVIS_TURN = (50 * Math.PI) / 180;
/** Tuned: one pivot turns the pelvis at most `PIVOTING` (rad) past the way the foot headed as it began: further, its hip turning about
 * the root over a foot that stays, the legs would cross */
export const PIVOTING = 3 * Math.PI / 4;
/** Tuned: a pivoting foot stays turned at most `PIVOTED` (rad) off the pelvis turning over it */
export const PIVOTED = (25 * Math.PI) / 180;
/** Tuned: the pelvis turns toward its facing at most at `TURN` (rad/s², rad/s) */
export const TURN = { accel: 100, speed: 12 };
/** Tuned: slower than `SHUFFLING` (m/s), a walker's feet alternate */
export const SHUFFLING = 0.6;
/** Tuned: the feet let the pelvis down at most `LOWEST` (m: a foot past reach leaves the leg straight instead) */
export const LOWEST = 0.12;
/** Tuned: the weight going off a foot, the centre of mass goes this far (m, default body) inside the other feet's prints */
const INSIDE = 0.01;
const _away = new Vector3();
/** Tuned: past `SETTLE` of a swing even a hard stop no longer moves its landing */
export const SETTLE = 0.8;
/** Tuned: a walker's landing moves no more past `AIMED` of its swing */
export const AIMED = 0.55;
/** Tuned: the least share of the narrowest stance a foot landing well ahead of or behind the other keeps from it sideways: walking, the feet
 * pass but never cross */
export const PASSING = 0.4;

/**
 * whether a planted foot is too far in under the body from its hip (`inward`, m, + toward the body's middle): a person's more than
 * `THRESHOLDS.medial`; a leg with its own `stray`, that far either way from where it stands under its hip
 */
export function strayed(st: Stepping, feet: Feet, leg: Leg, inward: number): boolean {
  return strayPast(st, feet, leg, inward) > 0;
}

/** how far (m) a planted foot `inward` from its hip is past straying (≤ 0: within) */
export function strayPast(st: Stepping, feet: Feet, leg: Leg, inward: number): number {
  const stray = feet.legs[leg.i].stray;
  if (stray === undefined) return inward - THRESHOLDS.medial * st.scale;
  return Math.abs(inward - ((feet.legs[leg.i].hip ?? feet.hip) - st.width.stand)) - stray;
}

/** how far in under the body (m) a foot `out` m out from the body's middle line may land and not be `strayed` there */
export function strayRoom(st: Stepping, feet: Feet, leg: Leg, out: number): number {
  const stray = feet.legs[leg.i].stray, hip = feet.legs[leg.i].hip ?? feet.hip;
  if (stray === undefined) return Math.max(0, THRESHOLDS.medial * st.scale - (hip - out));
  return Math.max(0, stray - (hip - out - (hip - st.width.stand)));
}

/** how far the pelvis is let down moving (× scale): walking, side-stepping, running */
/** whether `speed` (m/s: measured, asked or foreseen) is a run's, not a walk's: its stride has a flight */
export const runs = (st: Stepping, speed: number) => speed >= st.run[0];

/** What a stepper keeps from one sub-step to the next: its legs, its stride's time and the pelvis it carries. */
export class Steps {
  readonly legs: Leg[];
  /** the pelvis' facing (rad), how far it walks and runs (0 … 1), the gait's phase (rad), the stance's and cycle's durations (s); still
   * and squared up; off the floor (a leap's flight) */
  yaw: number; moving = 0; run = 0; phase = 0; Ts = 1; cycle = 2; settled = true; airborne = false;
  /** the leg whose foot the weight is going off (index): one waiting to lift till the weight is on the others, or one swinging from a body
   * slow enough to stand on the others meanwhile; none */
  unloading: number | null = null;
  /** how far the pelvis is shifted over the feet standing, a moment (m, on the floor: `Steering.shifted`) */
  readonly shifted = new Vector3();
  /** each foot's home put ahead (`Steering.stagger`), as this sub-step asks */
  stagger: readonly number[] | undefined = undefined;
  /**
   * where the centre of mass at `com` goes as the weight goes off `unloading`: just inside the other planted feet's prints (`INSIDE` m), on
   * the floor — no further than it must to stand on them; none: not going
   */
  onto(com: Readonly<Vector3>): Vector3 | null {
    const off = this.unloading;
    if (off === null) return null;
    const points = this.legs.filter((leg) => leg.i !== off && !leg.swing).flatMap((leg) => this.feet.print(leg.i, leg.anchor, leg.yaw));
    if (!points.length) return null;
    const at = this.ontoScratch.set(com.x, 0, com.z), beyond = past(hullOf(points), at, _away) + INSIDE * this.st.scale;
    return beyond > 0 ? at.addScaledVector(_away, -beyond) : at;
  }
  private readonly ontoScratch = new Vector3();
  /** the pelvis' height its planted feet alone hold it at (m): its swinging ones not holding it down — what a running body's ride is let down from */
  held = 0;
  /** how far down it is crouched (0 … 1): the root's `crouch`, eased in and out no faster than legs bend and straighten */
  crouch = 0;
  /** the pelvis turned off its facing (rad, + to the left) as the body has it with the stride: the hips the legs reach from turned with it */
  turn = 0;
  readonly crouches = [0, 0];
  /** each leg's one before it in the gait and its share of a cycle after it; the leg across its girdle and its share after that */
  readonly before: number[]; readonly gap: number[];
  readonly pair: number[]; readonly apart: number[];
  /** the pelvis' last two facings (rad) */
  readonly yaws: number[];
  /** how high the pelvis stands over the ground (m), as it first stood */
  stand = NaN;
  asked: number | undefined; rootYaw: number;
  /** the way (±1) the root went round, turning faster than `SPUN`, while it leads the pelvis by more than a quarter turn (`turnTo`); 0: none */
  way = 0;
  readonly jumping: Leap = { phase: 'ground', since: 0, speed: 0, land: 0, bottom: 0, rise: 0, vy: 0, a: 0 };
  low = NaN; most = Infinity; sense = 0; paused = 0;
  readonly hips = new Vector3();
  /** the clock its feet keep, with a `gait`: each lifts in its turn */
  readonly clock: GaitClock | null;
  /** how long a stride takes: a gait's clock, or a person's cadence */
  readonly pace: GaitClock | Cadence;
  /** where the pelvis stands this sub-step, and a hip's place worked out from it: kept for `pose`, which plants feet after `move` */
  readonly pelvis = new Vector3();
  readonly hipScratch = new Vector3();
  readonly heights = [0, 0];
  readonly velocity = new Vector3();
  poses: (FootPose | null)[] = [];
  /** the last `move`'s sub-step: what `pose` plants the feet by and `reachable` re-aims their landings for */
  input: StepInput | undefined;

  /** the ground its pelvis stands over: the floor under its way, smoothed over its stride */
  readonly ground: Ground;

  /**
   * `floor`: what the feet stand on, each landing fitted onto one level of it. `foreseen`: its root says where it goes (`Steering.forecast`:
   * a walker's, a planner's — a person's root then at its centre of mass, the hips holding it there and the feet's middle a little behind it)
   * or does not (a player's, followed — a person's root at its hips, the feet under them)
   */
  constructor(readonly st: Stepping, readonly feet: Feet, at: readonly { position: Vector3; yaw: number }[], yaw: number, readonly floor: Floor, readonly foreseen: boolean) {
    this.ground = new Ground(floor, feet.length);
    this.legs = at.map((foot, i) => ({
      i, sign: feet.legs[i].sign, anchor: foothold(floor, feet, i, foot.position.clone(), foot.yaw), yaw: foot.yaw, pitch: 0, heel: true, free: true,
      planted: 1, lifted: 1, strike: 0, landed: false, swing: null,
    }));
    // (each leg's one before it: the one whose offset comes round last before its own)
    const sooner = (o: number, p: number, best: number) => best < 0 || mod(o - p) < mod(o - st.offsets[best]);
    this.before = st.offsets.map((o, i) => st.offsets.reduce((best, p, j) => j !== i && sooner(o, p, best) ? j : best, -1));
    this.gap = st.offsets.map((o, i) => mod(o - st.offsets[this.before[i]]));
    this.pair = feet.legs.map((leg, i) => leg.partner ?? this.before[i]);
    this.apart = st.offsets.map((o, i) => mod(o - st.offsets[this.pair[i]]));
    this.yaw = this.rootYaw = yaw;
    this.yaws = [yaw, yaw];
    if (st.gait) this.pace = this.clock = new GaitClock(st.gait, st.offsets, feet, this.legs, foreseen);
    else [this.pace, this.clock] = [new Cadence(st), null];
  }

  /** how far the lowest of a sole's `points` is above the floor under it (m; − in it) */
  above(points: readonly Vector3[]): number {
    let least = Infinity;
    for (const p of points) least = Math.min(least, p.y - this.floor(p.x, p.z));
    return least;
  }

  /** the most the pelvis turns from a planted foot (rad) */
  get pelvisTurn() { return this.st.twist ?? PELVIS_TURN; }

  /** whether its feet pivot: a biped's that spin on the floor (`Feet.turnAbout`), each standing alone (`pivots`) */
  get pivoting() { return !this.clock && !!this.feet.turnAbout; }

  /** whether foot `leg` pivots: planted, the other in the air — the pelvis turns over it as far as `PIVOTING` past the way it headed as it
   * began (`Leg.pivot`), the foot turned after it (both pivoting, the legs would twist round each other) */
  pivots(leg: Leg): boolean { return this.pivoting && !leg.swing && !!this.legs[this.pair[leg.i]].swing; }

  /** the way pivoting foot `leg` headed as it began, its toe-out taken off (rad, unwrapped near `near`) */
  pivotFrom(leg: Leg, near: number): number { return near + wrapAngle((leg.pivot ?? leg.yaw) - this.st.toeOut * leg.sign - near); }
}
