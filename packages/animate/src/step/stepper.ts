// A reactive stepper: the scene moves the root, the legs step to keep up.
// Recalled: the procedural stepping of games (e.g. Rain World, Overgrowth, Unreal "Control Rig"
// foot placement): each foot has a home off the root; it steps when it falls too far from it,
// landing where the home will be.
import { MathUtils, Matrix4, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { follow } from '../kernel/follow';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, wrapAngle } from '../kernel/math';
import { LOWEST, PASSING, PIVOTED, PIVOTING, SETTLED_AFTER, THRESHOLDS, TURN, Steps, SPUN, turnTo } from './steps';
import { lengthOf, nominal, strokeOf, widthAt, dropOf } from './leg-reach';
import { swingOn } from './swing';
import { keepTime, liftFeet, promptsOf, wants } from './lifting';
import { reachable } from './reachable';
import { placePelvis } from './pelvis';
import { plantedPose } from './plant';
import { drivenLeap, leap } from './leap';
import { bindFeet, followFeet, transport } from './platform';
import { FLAT, LEVEL, levelUnder, type Floor } from './floor';
import type { StepBody, FootPose, Leg, StepInput, Physics, Reading, Steering, Timing } from './types';

/**
 * Legs under a root the scene drives (`move`, read every sub-step): the pelvis exactly over it,
 * facing its yaw (within a set turn of a planted foot, or of where a biped's foot standing alone began to pivot under it), bobbing with the steps and let down by
 * `crouch`; each foot stays where it stands until it falls too far from its home
 * (or is turned too far from it), then steps — after the leg before it in the gait, with a flight running — to
 * where its home will be as it lands: re-aimed through the first half of the swing, frozen after;
 * heel first, rolling flat. Asked to `jump`, the legs dip, push off, follow the body's ballistic arc
 * (the root steering it over the floor) and land it, the knees taking up the fall.
 *
 * A root that foresees where it goes (a walker's, a planner's `forecast`) and one that does not (a player's, followed) step
 * the same way but where a walker's knows more: its landings, its pelvis' turn and the order its feet take (`yields`).
 */
export class Stepper extends Steps {

  /** The fastest a planner takes it (m/s). */
  get top(): number { return this.pace.top; }

  /** Carry all gait state with the physical support, before reading this sub-step's root. */
  transport(matrix: Matrix4) { transport(this, matrix); }

  /** Ask for a leap at `speed` (m/s up): taken up on the next sub-step standing or rising from a landing. */
  jump(speed: number) { this.asked = speed; }

  /**
   * Step for this sub-step under `r` and set the root's position; the swinging feet's poses are planned now, the planted ones by `pose`
   * once the hips are placed. A sub-step reads the root, times the stance, faces the pelvis; carries the swings on, cues and clocks the
   * steps and lifts the feet that are due; then places the pelvis as high as the feet let it.
   */
  move(f: Frame, r: Steering) {
    const { st, legs } = this, s = st.scale;
    const physics = physicsOf(r, this.floor), stroke = strokeOf(this);
    followFeet(this);
    if (physics.flight && !Number.isNaN(this.stand)) {
      const carried = r.position.y - this.pelvis.y;
      this.heights[0] += carried;
      this.heights[1] += carried;
    }
    if (physics.contact && this.airborne) {
      this.ground.reset();
      // Contact ends the physics fall; its remaining displacement is carried once, then the knees absorb the impact.
      this.heights[1] += r.position.y - this.pelvis.y;
      this.heights[0] = this.heights[1];
    }
    this.stagger = r.stagger;
    const root = this.read(f, r, physics);
    const timing = this.timing(root, stroke);
    const yaw = this.face(root);
    const { v, crouch: k, run, tiptoe } = root;
    const timed = { ...root, ...timing }, ground = this.ground.at(r, f.dt, stroke, physics.contact), climb = this.ground.rising;
    // (first moved: standing as high over the ground as it stands)
    if (Number.isNaN(this.stand)) this.stand = this.heights[1] - ground;
    const body: StepBody = {
      ...timed, yaw, width: widthAt(this, timed, v), moving: MathUtils.smoothstep(v, 0, 1), ground, climb,
      standing: ground + this.stand - st.crouch.depth * s * k + tiptoe, over: _over.copy(r.com ?? ZERO).setY(0),
    };
    const input: StepInput = { ...body, ...this.landingReach(body) };
    this.input = input;
    this.carry(input);
    const prompts = promptsOf(this, input);
    keepTime(this, input, prompts);
    if (!r.seated) liftFeet(this, input, prompts);
    bindFeet(this, physics.contact && r.platform);
    placePelvis(this, input);
    const stepping = legs.some((leg) => leg.swing);
    this.phase += Math.PI * input.dt / (input.C / 2) * Number(stepping);
    [this.yaw, this.moving, this.run, this.Ts, this.cycle] = [yaw, input.moving, run, input.Ts, input.C];
    const still = !(v > 0.05 || stepping) && legs.every((leg) => leg.planted > SETTLED_AFTER);
    // (and no foot would step once the root is at rest: a root creeping to its rest is not yet settled on feet that would square up there)
    const resting = { ...input, v: 0 };
    this.settled = still && legs.every((leg) => !wants(this, resting, prompts, leg));
    // (a gait's body as low as its running lets it down)
    const drop = this.clock ? lerp(st.drop.walk, st.drop.run, run) : 0;
    [this.low, this.most] = [input.standing - (drop + st.bob + THRESHOLDS.short) * s, input.most];
  }

  /** Development check of the last final pose (`f.prev`), of a gait's order of feet. */
  check(f: Frame) { this.clock?.check(f, this); }

  /** The root read for this sub-step: the crouch eased in, the leap moved on, the root's speed, acceleration and turn. */
  private read(f: Frame, r: Steering, physics: Physics): Reading {
    const { st, jumping: jump, yaws, heights, velocity } = this, s = st.scale, dt = f.dt;
    // (first moved: standing where it is, moving as the root already does — a body spawned on the move gets no jolt)
    if (Number.isNaN(this.stand)) { heights[0] = heights[1] = f.prev.position(0).y; velocity.copy(r.velocity); }
    const v = Math.hypot(r.velocity.x, r.velocity.z);
    // (crouched: lower, the feet wider and a little ahead of the hips — the hips sit back — shorter, lower steps)
    const k = clamp(follow(this.crouches[0], this.crouches[1], minimumJerk(clamp(r.crouch ?? 0, 0, 1)), CROUCHING, dt), 0, 1);
    [this.crouches[0], this.crouches[1], this.crouch] = [this.crouches[1], k, k];
    const sitting = r.com ? 0 : st.crouch.ahead * s * k, tiptoe = Math.max(0, r.tiptoe ?? 0);
    const hips = this.hips.copy(r.hips ?? ZERO).setY(0);
    this.shifted.copy(r.shifted ?? ZERO);
    this.pelvis.copy(r.position).add(hips).add(this.shifted);
    // (the pelvis' own rise and fall: a leap's dip, flight and landing)
    const run = MathUtils.smoothstep(v, st.run[0], st.run[1]);
    if (!physics.physical) leap(jump, this.asked, run, s, dt);
    else drivenLeap(jump, !physics.flight, r.vertical ?? 0, run, s, dt);
    this.asked = undefined;
    let air = jump.phase === 'air' ? Math.max(0, jump.land - jump.since) : jump.phase === 'landed' ? 0 : undefined;
    if (physics.flight) {
      // (a short contact horizon poses the feet toward the floor; only physics can end the flight)
      const contact = (jump.vy + Math.sqrt(jump.vy ** 2 + 2 * GRAVITY * physics.clearance)) / GRAVITY;
      air = Math.max(dt, Math.min(HORIZON, contact));
    }
    this.airborne = air !== undefined;
    // (how its speed changes: how far a hard stop or turn leaves a landing)
    const accel = _accel.subVectors(r.velocity, velocity).divideScalar(dt);
    velocity.copy(r.velocity);
    // (the root's turn rate, to foresee its facing as a foot lands)
    const spin = clamp(wrapAngle(r.yaw - this.rootYaw) / dt, -SPIN, SPIN);
    // (the way round the root goes as it turns on ahead of the body — not as it turns back toward it — kept till the body has come within a
    // quarter turn of it)
    const rootAhead = turnTo(yaws[1], r.yaw, this.way);
    if (Math.abs(spin) > SPUN) {
      if (Math.sign(spin) === Math.sign(rootAhead)) this.way = Math.sign(spin);
    } else if (Math.abs(rootAhead) < Math.PI / 2) this.way = 0;
    const wanted = yaws[1] + turnTo(yaws[1], r.yaw, this.way);
    // (a gait's feet step for the turn the body would make, held back by them: else it waits on feet that wait on it; pivoting feet for the
    // turn the pelvis makes, up to `PACED` — as quick as it turns, they pivot no further than they step round; for the root's, a flick's
    // spike quickened a swing under way so much it slammed down)
    const turned = clamp((yaws[1] - yaws[0]) / dt, -PACED, PACED);
    const pressed = this.clock && r.wanted ? clamp(r.wanted.angular, -SPIN, SPIN)
      : this.pivoting && Math.abs(turned) > Math.abs(spin) ? turned : spin;
    this.rootYaw = r.yaw;
    return {
      ...physics, f, r, dt, v, run, accel, crouch: k, sitting, tiptoe, rise: jump.rise, vy: jump.vy,
      airborne: air !== undefined, air: air ?? 0, wanted, spin, pressed, held: pressed !== spin, spinning: Math.abs(pressed) > SPIN,
    };
  }

  /** The stance's duration (quicker turning), its travel kept within reach in the direction of travel. */
  private timing(root: Reading, stroke: number): Timing {
    const { st, yaws, pace } = this, s = st.scale, { r, v, run, crouch: k, pressed, wanted } = root;
    const forward = forwardOf(yaws[1]), left = leftOf(yaws[1]);
    const pacing = Math.max(pace.coming(root), TURNING * s * (Math.abs(pressed) + Math.abs(wanted - yaws[1])));
    const along = v > 1e-6 ? r.velocity.dot(forward) / v : 1, across = v > 1e-6 ? r.velocity.dot(left) / v : 0;
    const travel = along > 0 ? lerp(st.travel.forward, st.travel.run, run) : st.travel.back;
    const most = (1 - st.crouch.travel * k) * s / Math.hypot(along / travel, across / st.travel.side);
    const stride = pace.stride(root, pacing, most, across), duty = stride.duty;
    let { C, Ts } = stride;
    const Tsw = C - Ts;
    const terrain = descent(this.floor, root.contact, r.velocity, C, stroke);
    if (terrain < 1) {
      // Lift sooner on a descent; the leg still needs its swing time to clear the upper tread.
      Ts = Math.max(root.dt, C * terrain - Tsw);
      C = Ts + Tsw;
    }
    const landAhead = Math.min(lerp(st.landAhead.share, st.landAhead.side, Math.abs(across)) * Ts, (lerp(st.landAhead.most, st.landAhead.run, run) * s) / Math.max(v, 1e-6));
    return { pacing, across, C, duty: terrain < 1 ? Ts / C : duty, Ts, Tsw, most, landAhead };
  }

  /** The pelvis' facing: the root's, within reach of the feet's (as they stand or will land). */
  private face({ f, r, dt, wanted, spin }: Reading): number {
    const { st, feet, legs, yaws, pair } = this, s = st.scale, toeOut = st.toeOut;
    let low = -Infinity, high = Infinity;
    for (const leg of legs) {
      // (with a foreseen root, a swinging foot as it is turned now: its landing foresees the whole turn, the hips do not yet; a planted foot
      // as far as it pivots, turned after the pelvis, `carry`)
      const turned = leg.swing && r.forecast ? leg.swing.turn.x : leg.yaw, pivots = this.pivots(leg);
      const body = pivots ? this.pivotFrom(leg, yaws[1]) : yaws[1] + wrapAngle(turned - leg.sign * toeOut - yaws[1]), most = pivots ? PIVOTING : this.pelvisTurn;
      [low, high] = [Math.max(low, body - most), Math.min(high, body + most)];
    }
    // A biped cannot turn its pelvis through the line between its feet while the trailing foot is still leaving the floor — but over a
    // foot it pivots on as its root turns on, the other swinging round it (catching up once it stops, the pelvis would swing on past the
    // turn)
    if (!this.clock && !(Math.abs(spin) >= SPIN && legs.some((leg) => this.pivots(leg)))) for (const leg of legs) {
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
    // (a gait's body faces as its root does: its planner turns it no faster than its feet keep up; a person's closes on its goal as one
    // still — braking into a goal that stops turning, never past it: tracked at the goal's rate, a fast-spun pelvis would overshoot it)
    let yaw = this.clock ? wanted : follow(yaws[0], yaws[1], goal, TURN, dt);
    yaw = this.foresee(r, dt, yaw, goal, low, high);
    [yaws[0], yaws[1]] = [yaws[1], yaw];
    return yaw;
  }

  /**
   * The pelvis facing `yaw`, toward `goal`, as a walker's — a foreseen root's — turns it: never past the feet's reach of it (`low` …
   * `high`), braking into the limit; past it in the way the root turns, or turned up to `PAUSE` s ago, never turning back: it waits for it.
   */
  private foresee(r: Steering, dt: number, yaw: number, goal: number, low: number, high: number): number {
    const { yaws } = this;
    if (!r.forecast || this.clock) return yaw;
    if (low <= high) yaw = clamp(yaw, low, high);
    const turning = Math.sign(wrapAngle(r.forecast(SENSING).yaw - r.yaw));
    [this.sense, this.paused] = turning !== 0 ? [turning, 0] : [this.sense, this.paused + dt];
    if (this.paused < PAUSE && (yaw - yaws[1]) * this.sense < 0 && (yaws[1] - goal) * this.sense > 0) return yaws[1];
    return yaw;
  }

  /** The furthest from under its hip a foot lands (m): the height a landing must hold the hip at, and how far out it may land so, as
   * the legs stand before they move this sub-step. */
  private landingReach(body: StepBody): { holding: number; reaches: number[] } {
    const { st, feet, legs } = this, s = st.scale, { r, standing, moving } = body;
    // A planned root can slow for a landing at its contact height; an externally driven one may need extra drop.
    const holding = r.forecast
      ? standing - (dropOf(st, body) + st.bob) * s * moving
      : Math.max(nominal(this, body) - LANDING.drop * s, standing - (LOWEST - LANDING.drop / 2) * s);
    const reaches = legs.map((leg) =>
      Math.max(LANDING.least * s, Math.sqrt(Math.max(0, (st.reach * lengthOf(this, leg)) ** 2 - (holding + (feet.legs[leg.i].up ?? 0) - body.ground - feet.ankleHeight) ** 2))));
    return { holding, reaches };
  }

  /**
   * The feet carried on: the swings on their way, the planted feet standing — a gait's that pivots turning in place, heading the body's
   * way; a biped's standing alone pivoting as the pelvis turns over it (`pivots`), no further off it than `PIVOTED`.
   */
  private carry(input: StepInput) {
    const { st, feet, legs } = this, { dt, yaw } = input;
    for (const leg of legs) {
      leg.landed = false;
      if (leg.swing) {
        leg.pivot = undefined;
        swingOn(this, input, leg, leg.swing);
      } else {
        leg.planted += dt;
        const off = wrapAngle(yaw + leg.sign * st.toeOut - leg.yaw);
        // (a pivot begun on a foot the pelvis had turned further from, standing on both, keeps its turn and closes on it no faster than
        // `CLOSING`: snapped to it, the hip jerked round)
        const most = Math.abs(this.yaws[1] - this.yaws[0]) + CLOSING * dt;
        const turn = this.clock ? off : this.pivots(leg) ? this.fitted(leg, clamp(off - clamp(off, -PIVOTED, PIVOTED), -most, most)) : 0;
        if (feet.turnAbout && turn !== 0) {
          if (!this.clock) leg.pivot ??= leg.yaw;
          feet.turnAbout(leg.i, leg.anchor, leg.yaw, leg.yaw + turn, leg.pitch);
          leg.yaw += turn;
        }
      }
      leg.lifted += dt;
    }
  }

  /** as much of `turn` (rad) as pivots a biped's planted foot with its sole still on the level it stands on: spun over a tread's edge, it
   * would stand off it */
  private fitted(leg: Leg, turn: number): number {
    const { feet, floor } = this, level = leg.anchor.y - feet.ankleHeight;
    const fits = (t: number) => {
      const anchor = _pivot.copy(leg.anchor);
      feet.turnAbout?.(leg.i, anchor, leg.yaw, leg.yaw + t, leg.pitch);
      const on = levelUnder(floor, feet.print(leg.i, anchor, leg.yaw + t));
      return on !== null && Math.abs(on - level) <= LEVEL;
    };
    if (floor === FLAT || fits(turn)) return turn;
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 8; k++) [lo, hi] = fits(turn * (lo + hi) / 2) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    return turn * lo;
  }

  /** Whether the legs keep up with a root that goes as `forecast` has it; reads the last `move`, changes nothing. */
  reachable(forecast: (ahead: number) => { position: Vector3; yaw: number }): boolean { return reachable(this, forecast); }

  /**
   * Leg `i`'s foot posed for this sub-step with its top joint at `top` (as the hips now stand); a swinging leg is never asked past its
   * reach, where the knee's swivel is undefined.
   */
  pose(i: number, top: Vector3): FootPose {
    const leg = this.legs[i], st = this.st, length = this.feet.legs[i].length ?? this.feet.length;
    const pose = this.poses[i] ?? plantedPose(this, leg, top);
    const d = _d.subVectors(pose.ankle, top), l = d.length(), from = st.swingReach * length, span = (st.reach - st.swingReach) * length;
    if (leg.swing && l > from) {
      const eased = (from + span * Math.tanh((l - from) / span)) / l;
      pose.ankle.lerp(_a.copy(top).addScaledVector(d, eased), this.airborne ? 1 : 1 - minimumJerk((leg.swing.u - 0.8) / 0.15));
    }
    return pose;
  }
}

/** The cycle's share that keeps a descent within the legs' `stroke` (m), standing on `contact` and going at `velocity`. */
export function descent(floor: Floor, contact: Vector3 | undefined, velocity: Vector3, cycle: number, stroke: number): number {
  if (!contact || velocity.x === 0 && velocity.z === 0) return 1;
  let last = contact.y, numerator = 0, denominator = 0;
  for (let i = 0; i <= DESCENT_SAMPLES; i++) {
    const at = i / DESCENT_SAMPLES, t = cycle * at;
    const height = i === 0 ? contact.y : floor(contact.x + velocity.x * t, contact.z + velocity.z * t);
    // A disconnected ledge needs flight, not a quicker step.
    if (Math.abs(height - last) > stroke / 2) return 1;
    // Fit the grade rather than count risers: moving past one nosing must not change cadence by a whole stair.
    numerator += (at - 0.5) * (height - contact.y);
    denominator += (at - 0.5) ** 2;
    last = height;
  }
  const drop = -numerator / denominator;
  return drop > stroke ? stroke / drop : 1;
}

/** Tuned: in a flight physics owns, the feet are posed for a landing no further off than this (s) */
const HORIZON = 0.3;
/** how many points along a cycle's travel `descent` reads the floor at */
const DESCENT_SAMPLES = 16;

/** Tuned: a pivoting foot turned further off the pelvis than `PIVOTED` closes on it this much faster than the pelvis turns (rad/s) */
const CLOSING = 2;
/** Tuned: a pivoting biped steps as quick as for a turn of `PACED` (rad/s) at most: quicker, a swing quickened late came down hard */
const PACED = 8;
/** Tuned: a landing foresees at most `SPIN` (rad/s) of the root's turn */
const SPIN = 1.5;
/** Tuned: turning steps as quick as walking `TURNING` m/s per rad/s turned or rad behind */
const TURNING = 0.5;
/** Tuned: a walker's pelvis never turns back past its root against the way the root turns `SENSING` s on */
const SENSING = 0.3;
/** Tuned: nor for `PAUSE` s after it stops turning */
const PAUSE = 0.5;
/** Tuned: a landing is kept within the leg's reach with the pelvis let down `drop` (m) more, never nearer than `least` (m) */
const LANDING = { drop: 0.06, least: 0.15 };
/** Tuned (shares of the crouch's depth /s², /s): the crouch leaves room for the pelvis's adjustment to its feet below a 0.25 s
 * minimum-jerk crouch's peak (~34 m/s² at 0.37 m depth); at 90, the combined onset reached 39 m/s². */
const CROUCHING = { accel: 60, speed: 7.5 };
const ZERO = new Vector3();
const [_a, _accel, _d, _pivot, _over] = Array.from({ length: 5 }, () => new Vector3());

export function physicsOf({ support, position }: Steering, floor: Floor): Physics {
  const flight = support === null;
  return { physical: support !== undefined, contact: support ?? undefined, flight, clearance: flight ? Math.max(0, position.y - floor(position.x, position.z)) : 0 };
}
