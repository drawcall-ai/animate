// A reactive stepper: the scene moves the root, the legs step to keep up.
// Recalled: the procedural stepping of games (e.g. Rain World, Overgrowth, Unreal "Control Rig"
// foot placement): each foot has a home off the root; it steps when it falls too far from it,
// landing where the home will be.
import { MathUtils, Matrix4, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { follow } from '../kernel/follow';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, wrapAngle } from '../kernel/math';
import { LOWEST, PASSING, PIVOTED, PIVOTING, SETTLED_AFTER, SPUN, THRESHOLDS, TURN, turnTo } from './thresholds';
import { lengthOf, nominal, strokeOf, widthAt, dropOf } from './leg-reach';
import { swingOn } from './swing';
import { keepTime, liftFeet, promptsOf, wants } from './lifting';
import { reachable } from './reachable';
import { placePelvis } from './pelvis';
import { plantedPose } from './plant';
import { drivenLeap, leap } from './leap';
import { bindFeet, followFeet, transport } from './platform';
import { FLAT, foothold, LEVEL, levelUnder, type Floor } from './floor';
import { Cadence, GaitClock } from './gait-clock';
import { Ground } from './ground';
import { hullOf, past } from './support';
import type { Feet, FootPose, Leap, Leg, Physics, Reading, Steering, StepInput, Stepping, Timing } from './types';

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
export class Stepper {
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
  /** where the feet's middle stood as a stagger began standing: their homes are put about it, not off the root settling over them, till
   * they have squared up again; none under way */
  staggeredAt: Vector3 | undefined = undefined;
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
  /** the height a landing must hold the hip at (m) and how far out each foot may land so (m), as the legs stood before they moved this sub-step */
  holding = 0;
  reaches: number[] = [];
  private moved: StepInput | undefined;
  /** this sub-step's reading, from when it has been read; between sub-steps, the last one's: what `pose` plants the feet by and `reachable` re-aims their landings for */
  get input(): StepInput {
    if (!this.moved) throw new Error('stepper: read before its first move');
    return this.moved;
  }

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
    const sooner = (o: number, p: number, best: number) => best < 0 || MathUtils.euclideanModulo(o - p, 1) < MathUtils.euclideanModulo(o - st.offsets[best], 1);
    this.before = st.offsets.map((o, i) => st.offsets.reduce((best, p, j) => j !== i && sooner(o, p, best) ? j : best, -1));
    this.gap = st.offsets.map((o, i) => MathUtils.euclideanModulo(o - st.offsets[this.before[i]], 1));
    this.pair = feet.legs.map((leg, i) => leg.partner ?? this.before[i]);
    this.apart = st.offsets.map((o, i) => MathUtils.euclideanModulo(o - st.offsets[this.pair[i]], 1));
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
    // (staggered about where the feet stood, till they have squared up again: off the root, which settles over the feet's middle as the
    // first foot steps, the second foot's home ran on after it and a third step trimmed it, on one foot past its XCoM; squaring up, the
    // back foot stepped after the root again and again, and each stagger crept the body on by up to half of it)
    if (underway(r)) this.staggeredAt = undefined;
    else if (r.stagger) this.staggeredAt ??= this.legs.reduce((sum, leg) => sum.add(leg.anchor), new Vector3()).divideScalar(this.legs.length);
    const root = read(this, f, r, physics);
    const stride = timing(this, root, stroke);
    const yaw = face(this, root);
    const { v, crouch: k, run, tiptoe } = root;
    const timed = { ...root, ...stride }, ground = this.ground.at(r, f.dt, stroke, physics.contact), climb = this.ground.rising;
    // (first moved: standing as high over the ground as it stands)
    if (Number.isNaN(this.stand)) this.stand = this.heights[1] - ground;
    const input: StepInput = this.moved = {
      ...timed, yaw, width: widthAt(this, timed, v), moving: MathUtils.smoothstep(v, 0, 1), ground, climb,
      standing: ground + this.stand - st.crouch.depth * s * k + tiptoe, over: _over.copy(r.com ?? ZERO).setY(0),
    };
    landingReach(this);
    advanceFeet(this);
    const prompts = promptsOf(this);
    keepTime(this, prompts);
    if (!r.seated) liftFeet(this, prompts);
    bindFeet(this, physics.contact && r.platform);
    placePelvis(this);
    const stepping = legs.some((leg) => leg.swing);
    this.phase += Math.PI * input.dt / (input.C / 2) * Number(stepping);
    [this.yaw, this.moving, this.run, this.Ts, this.cycle] = [yaw, input.moving, run, input.Ts, input.C];
    const still = !(v > STILL || stepping) && legs.every((leg) => leg.planted > SETTLED_AFTER);
    // (and no foot would step once the root is at rest: a root creeping to its rest is not yet settled on feet that would square up there)
    this.settled = still && legs.every((leg) => !wants(this, prompts, leg, 0));
    if (!r.stagger && this.settled) this.staggeredAt = undefined;
    // (a gait's body as low as its running lets it down)
    const drop = this.clock ? lerp(st.drop.walk, st.drop.run, run) : 0;
    [this.low, this.most] = [input.standing - (drop + st.bob + THRESHOLDS.short) * s, input.most];
  }

  /** Development check of the last final pose (`f.prev`), of a gait's order of feet. */
  check(f: Frame) { this.clock?.check(f, this); }

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

/** The root read for this sub-step: the crouch eased in, the leap moved on, the root's speed, acceleration and turn. */
function read(stepper: Stepper, f: Frame, r: Steering, physics: Physics): Reading {
  const { st, jumping: jump, yaws, heights, velocity } = stepper, s = st.scale, dt = f.dt;
  // (first moved: standing where it is, moving as the root already does — a body spawned on the move gets no jolt)
  if (Number.isNaN(stepper.stand)) { heights[0] = heights[1] = f.prev.position(0).y; velocity.copy(r.velocity); }
  const v = Math.hypot(r.velocity.x, r.velocity.z);
  // (crouched: lower, the feet wider and a little ahead of the hips — the hips sit back — shorter, lower steps)
  const k = clamp(follow(stepper.crouches[0], stepper.crouches[1], minimumJerk(clamp(r.crouch ?? 0, 0, 1)), CROUCHING, dt), 0, 1);
  [stepper.crouches[0], stepper.crouches[1], stepper.crouch] = [stepper.crouches[1], k, k];
  const sitting = r.com ? 0 : st.crouch.ahead * s * k, tiptoe = Math.max(0, r.tiptoe ?? 0);
  const hips = stepper.hips.copy(r.hips ?? ZERO).setY(0);
  stepper.shifted.copy(r.shifted ?? ZERO);
  stepper.pelvis.copy(r.position).add(hips).add(stepper.shifted);
  // (the pelvis' own rise and fall: a leap's dip, flight and landing)
  const run = MathUtils.smoothstep(v, st.run[0], st.run[1]);
  if (!physics.physical) leap(jump, stepper.asked, run, s, dt);
  else drivenLeap(jump, !physics.flight, r.vertical ?? 0, run, s, dt);
  stepper.asked = undefined;
  let air = jump.phase === 'air' ? Math.max(0, jump.land - jump.since) : jump.phase === 'landed' ? 0 : undefined;
  if (physics.flight) {
    // (a short contact horizon poses the feet toward the floor; only physics can end the flight)
    const contact = (jump.vy + Math.sqrt(jump.vy ** 2 + 2 * GRAVITY * physics.clearance)) / GRAVITY;
    air = Math.max(dt, Math.min(HORIZON, contact));
  }
  stepper.airborne = air !== undefined;
  // (how its speed changes: how far a hard stop or turn leaves a landing)
  const accel = _accel.subVectors(r.velocity, velocity).divideScalar(dt);
  velocity.copy(r.velocity);
  // (the root's turn rate, to foresee its facing as a foot lands)
  const spin = clamp(wrapAngle(r.yaw - stepper.rootYaw) / dt, -SPIN, SPIN);
  // (the way round the root goes as it turns on ahead of the body — not as it turns back toward it — kept till the body has come within a
  // quarter turn of it)
  const rootAhead = turnTo(yaws[1], r.yaw, stepper.way);
  if (Math.abs(spin) > SPUN) {
    if (Math.sign(spin) === Math.sign(rootAhead)) stepper.way = Math.sign(spin);
  } else if (Math.abs(rootAhead) < Math.PI / 2) stepper.way = 0;
  const wanted = yaws[1] + turnTo(yaws[1], r.yaw, stepper.way);
  // (a gait's feet step for the turn the body would make, held back by them: else it waits on feet that wait on it; pivoting feet for the
  // turn the pelvis makes, up to `PACED` — as quick as it turns, they pivot no further than they step round; for the root's, a flick's
  // spike quickened a swing under way so much it slammed down)
  const turned = clamp((yaws[1] - yaws[0]) / dt, -PACED, PACED);
  const pressed = stepper.clock && r.wanted ? clamp(r.wanted.angular, -SPIN, SPIN)
    : stepper.pivoting && Math.abs(turned) > Math.abs(spin) ? turned : spin;
  stepper.rootYaw = r.yaw;
  return {
    ...physics, f, r, dt, v, run, accel, crouch: k, sitting, tiptoe, rise: jump.rise, vy: jump.vy,
    airborne: air !== undefined, air: air ?? 0, wanted, spin, pressed, held: pressed !== spin, spinning: Math.abs(pressed) > SPIN,
  };
}

/** The stance's duration (quicker turning), its travel kept within reach in the direction of travel. */
function timing(stepper: Stepper, root: Reading, stroke: number): Timing {
  const { st, yaws, pace } = stepper, s = st.scale, { r, v, run, crouch: k, pressed, wanted } = root;
  const forward = forwardOf(yaws[1]), left = leftOf(yaws[1]);
  const pacing = Math.max(pace.coming(root), TURNING * s * (Math.abs(pressed) + Math.abs(wanted - yaws[1])));
  const along = v > 1e-6 ? r.velocity.dot(forward) / v : 1, across = v > 1e-6 ? r.velocity.dot(left) / v : 0;
  const travel = along > 0 ? lerp(st.travel.forward, st.travel.run, run) : st.travel.back;
  const most = (1 - st.crouch.travel * k) * s / Math.hypot(along / travel, across / st.travel.side);
  const stride = pace.stride(root, pacing, most, across), duty = stride.duty;
  let { C, Ts } = stride;
  const Tsw = C - Ts;
  const terrain = descent(stepper.floor, root.contact, r.velocity, C, stroke);
  if (terrain < 1) {
    // Lift sooner on a descent; the leg still needs its swing time to clear the upper tread.
    Ts = Math.max(root.dt, C * terrain - Tsw);
    C = Ts + Tsw;
  }
  const landAhead = Math.min(lerp(st.landAhead.share, st.landAhead.side, Math.abs(across)) * Ts, (lerp(st.landAhead.most, st.landAhead.run, run) * s) / Math.max(v, 1e-6));
  return { pacing, across, C, duty: terrain < 1 ? Ts / C : duty, Ts, Tsw, most, landAhead };
}

/** The pelvis' facing: the root's, within reach of the feet's (as they stand or will land). */
function face(stepper: Stepper, { f, r, dt, wanted, spin }: Reading): number {
  const { st, feet, legs, yaws, pair } = stepper, s = st.scale, toeOut = st.toeOut;
  let low = -Infinity, high = Infinity;
  for (const leg of legs) {
    // (with a foreseen root, a swinging foot as it is turned now: its landing foresees the whole turn, the hips do not yet; a planted foot
    // as far as it pivots, turned after the pelvis, `advanceFeet`)
    const turned = leg.swing && stepper.foreseen ? leg.swing.turn.x : leg.yaw, pivots = stepper.pivots(leg);
    const body = pivots ? stepper.pivotFrom(leg, yaws[1]) : yaws[1] + wrapAngle(turned - leg.sign * toeOut - yaws[1]), most = pivots ? PIVOTING : stepper.pelvisTurn;
    [low, high] = [Math.max(low, body - most), Math.min(high, body + most)];
  }
  // A biped cannot turn its pelvis through the line between its feet while the trailing foot is still leaving the floor — but over a
  // foot it pivots on as its root turns on, the other swinging round it (catching up once it stops, the pelvis would swing on past the
  // turn)
  if (!stepper.clock && !(Math.abs(spin) >= SPIN && legs.some((leg) => stepper.pivots(leg)))) for (const leg of legs) {
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
  let yaw = stepper.clock ? wanted : follow(yaws[0], yaws[1], goal, TURN, dt);
  yaw = foresee(stepper, r, dt, yaw, goal, low, high);
  [yaws[0], yaws[1]] = [yaws[1], yaw];
  return yaw;
}

/**
 * The pelvis facing `yaw`, toward `goal`, as a walker's — a foreseen root's — turns it: never past the feet's reach of it (`low` …
 * `high`), braking into the limit; past it in the way the root turns, or turned up to `PAUSE` s ago, never turning back: it brakes and waits for it.
 */
function foresee(stepper: Stepper, r: Steering, dt: number, yaw: number, goal: number, low: number, high: number): number {
  const { yaws } = stepper;
  if (!r.forecast || stepper.clock) return yaw;
  if (low <= high) yaw = clamp(yaw, low, high);
  const turning = Math.sign(wrapAngle(r.forecast(SENSING).yaw - r.yaw));
  [stepper.sense, stepper.paused] = turning !== 0 ? [turning, 0] : [stepper.sense, stepper.paused + dt];
  // (coming to a stop as it brakes for anything: stopped dead at 3 rad/s, it jerked the head on the chest at 200 rad/s²)
  if (stepper.paused < PAUSE && (yaw - yaws[1]) * stepper.sense < 0 && (yaws[1] - goal) * stepper.sense > 0) return follow(yaws[0], yaws[1], yaws[1], TURN, dt);
  return yaw;
}

/** The furthest from under its hip a foot lands (m): the height a landing must hold the hip at, and how far out it may land so, as
 * the legs stand before they move this sub-step. */
function landingReach(stepper: Stepper): void {
  const { st, feet, legs, input: body } = stepper, s = st.scale, { standing, moving } = body;
  // A planned root can slow for a landing at its contact height; an externally driven one may need extra drop.
  const holding = stepper.foreseen
    ? standing - (dropOf(st, body) + st.bob) * s * moving
    : Math.max(nominal(stepper) - LANDING.drop * s, standing - (LOWEST - LANDING.drop / 2) * s);
  const reaches = legs.map((leg) =>
    Math.max(LANDING.least * s, Math.sqrt(Math.max(0, (st.reach * lengthOf(stepper, leg)) ** 2 - (holding + (feet.legs[leg.i].up ?? 0) - body.ground - feet.ankleHeight) ** 2))));
  [stepper.holding, stepper.reaches] = [holding, reaches];
}

/**
 * The feet carried on: the swings on their way, the planted feet standing — a gait's that pivots turning in place, heading the body's
 * way; a biped's standing alone pivoting as the pelvis turns over it (`pivots`), no further off it than `PIVOTED`.
 */
function advanceFeet(stepper: Stepper) {
  const { st, feet, legs } = stepper, { dt, yaw } = stepper.input;
  for (const leg of legs) {
    leg.landed = false;
    if (leg.swing) {
      leg.pivot = undefined;
      swingOn(stepper, leg, leg.swing);
    } else {
      leg.planted += dt;
      const off = wrapAngle(yaw + leg.sign * st.toeOut - leg.yaw);
      // (a pivot begun on a foot the pelvis had turned further from, standing on both, keeps its turn and closes on it no faster than
      // `CLOSING`: snapped to it, the hip jerked round)
      const most = Math.abs(stepper.yaws[1] - stepper.yaws[0]) + CLOSING * dt;
      const turn = stepper.clock ? off : stepper.pivots(leg) ? fitted(stepper, leg, clamp(off - clamp(off, -PIVOTED, PIVOTED), -most, most)) : 0;
      if (feet.turnAbout && turn !== 0) {
        if (!stepper.clock) leg.pivot ??= leg.yaw;
        feet.turnAbout(leg.i, leg.anchor, leg.yaw, leg.yaw + turn, leg.pitch);
        leg.yaw += turn;
      }
    }
    leg.lifted += dt;
  }
}

/** as much of `turn` (rad) as pivots a biped's planted foot with its sole still on the level it stands on: spun over a tread's edge, it
 * would stand off it */
function fitted(stepper: Stepper, leg: Leg, turn: number): number {
  const { feet, floor } = stepper, level = leg.anchor.y - feet.ankleHeight;
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

/** Tuned: the pelvis turns at most `PELVIS_TURN` (rad) from a planted foot's facing (the trunk and gaze take the rest) */
const PELVIS_TURN = (50 * Math.PI) / 180;
/** Tuned: a root slower than `STILL` (m/s), not said to be under way, stands */
const STILL = 0.05;

/** whether root `r` is under way: as its planner says, else moving at `STILL` or faster */
export function underway(r: Steering): boolean {
  return r.underway ?? Math.hypot(r.velocity.x, r.velocity.z) > STILL;
}
/** Tuned: the weight going off a foot, the centre of mass goes this far (m, default body) inside the other feet's prints */
const INSIDE = 0.01;
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
const [_a, _accel, _away, _d, _pivot, _over] = Array.from({ length: 6 }, () => new Vector3());

export function physicsOf({ support, position }: Steering, floor: Floor): Physics {
  const flight = support === null;
  return { physical: support !== undefined, contact: support ?? undefined, flight, clearance: flight ? Math.max(0, position.y - floor(position.x, position.z)) : 0 };
}
