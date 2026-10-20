// A reactive stepper: the scene moves the root, the legs step to keep up.
// Recalled: the procedural stepping of games (e.g. Rain World, Overgrowth, Unreal "Control Rig"
// foot placement): each foot has a home under its hip; it steps when it falls too far from it,
// landing where the home will be.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../body';
import type { ReadonlyPose } from '../pose';
import { follow } from '../follow';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, smoothstep, softMin, softplus, wrapAngle } from '../math';
import { quintic } from './swing';

/** The root a scene drives: its point on the floor, its velocity over it (m/s), its facing (rad about +Y), how far it crouches (0 standing … 1 a deep crouch). */
export interface DrivenRoot {
  position: Vector3;
  velocity: Vector3;
  yaw: number;
  crouch?: number;
}

/**
 * A species' stepping, in metres of its default body (× `scale`) and seconds (the human one, `humanStepping`, gives each value's
 * provenance): each leg's place in the cycle (`offsets`, 0 … 1: a leg follows the one just before it); the feet's `toeOut` (rad, × side);
 * the `cadence` (cycle 2 / (base + perSpeed v)); `duty` walking, side-stepping, running (`run`: between these speeds); the most `travel`
 * of a stance; the landing's `lead`; half the feet's spread (`width.stand` already scaled); the pelvis' `bob` and `drop`; the swing's
 * `lift` (a runner's ∝ u^`arc` (1 − u)³); the heel `strike`; the most a planted foot rolls (`pitch`, rad) and the ankle bends
 * (`dorsiflexion`); the `crouch`; the leg's `reach` (× length, a swinging leg's easing off from `swingReach`); the sole's `clearance`.
 */
export interface Stepping {
  scale: number; offsets: readonly number[]; toeOut: number; cadence: { base: number; perSpeed: number };
  duty: { walk: number; side: number; run: number }; run: readonly [number, number]; travel: { forward: number; run: number; back: number; side: number };
  lead: { share: number; side: number; most: number; run: number }; width: { stand: number; walk: number; run: number; narrowest: number };
  bob: number; drop: { walk: number; side: number; run: number }; lift: { walk: number; run: number; jump: number }; arc: number;
  strike: { walk: number; run: number; ahead: number }; pitch: { heel: number; ball: number }; dorsiflexion: number;
  crouch: { depth: number; wider: number; ahead: number; travel: number; lift: number }; reach: number; swingReach: number; clearance: number;
}

/**
 * A species' feet: each leg's side (+1 left) and bones, its hip's half width and the leg's lengths (m); where the ankle is for a foot
 * planted at `anchor` turned `yaw` and rolled `pitch`, the foot's turn, its sole's lowest point posed so, the shank's lean over it in a pose.
 */
export interface Feet {
  legs: readonly { sign: 1 | -1; foot: number; toes: number; top: number }[];
  hip: number; length: number; thigh: number; shin: number; ankleHeight: number;
  ankle(i: number, anchor: Readonly<Vector3>, yaw: number, pitch: number, out: Vector3): Vector3;
  rotation(yaw: number, pitch: number, out: Quaternion): Quaternion;
  sole(i: number, ankle: Vector3, foot: Quaternion, toes: Quaternion): number;
  lean(i: number, pose: ReadonlyPose, yaw: number): number;
}

export interface FootPose { ankle: Vector3; foot: Quaternion; toes: Quaternion; yaw: number }
interface Swing { u: number; age: number; rest: number; T: number; x: Vector3; v: Vector3; a: Vector3; fromYaw: number; fromPitch: number; toes: Quaternion; strike: number; lift: number; run: number; rel: { x: number; v: number; a: number } | null }
export interface Leg { i: number; leapt?: boolean; sign: 1 | -1; anchor: Vector3; yaw: number; pitch: number; heel: boolean; free: boolean; planted: number; lifted: number; strike: number; landed: boolean; swing: Swing | null }
type Leap = { phase: 'ground' | 'launch' | 'air' | 'landed' | 'down' | 'up'; since: number; speed: number; land: number; bottom: number; rise: number; vy: number; a: number };

/**
 * Tuned: moving, a foot lifts whatever the others do once it has stood `DUE` stances or is `DUE` stances' travel off its home. It steps once it
 * is due (its gait share of a cycle after the leg before it lifted; standing, after `square` s) and is `distance` (m; standing still and
 * upright: `still`, the stance squared up evenly) off its home, or turned `turn` (rad; still: `squared`) off it; at once if it would hold the
 * pelvis `short` (m) below its height, or is `medial` (m) in from its hip under the body, or a whole stance's travel behind it. A step that
 * would end `BLOCKED` (m) across the other foot waits for the other to step first. The pelvis turns at most `PELVIS_TURN` (rad) from a planted
 * foot's facing (the trunk and gaze take the rest), at `TURN` (rad/s², rad/s); a landing foresees at most `SPIN` (rad/s) of the root's turn;
 * turning steps as quick as walking `TURNING` m/s per rad/s turned or rad behind.
 */
const DUE = 1.5, BLOCKED = 0.05, PELVIS_TURN = (50 * Math.PI) / 180, SPIN = 1.5, TURNING = 0.5, TURN = { accel: 80, speed: 8 };
const STEP = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/**
 * Tuned: a strike rolls flat in `ROLL` s; the heel's lift eases in over `BEND` (rad) of a lean past the ankle's bend; within `PIVOT` (m) of
 * being over a planted foot the hip lets it settle flat to change the end it rolls on. A root rising (getting up from a landing) asks
 * `RISING` s sooner for a foot out of reach: it steps before its leg goes straight. The feet let the pelvis down at most `LOWEST` (m: a foot
 * past reach leaves the leg straight instead), and it takes its height up again within `RISE` (m/s²); a landing is kept within the leg's
 * reach with the pelvis let down `LANDING.drop` (m) more, never nearer than `least` (m). A swing's duration grows with the gait's at most
 * `PACE` (s/s); past `SETTLE` of it even a hard stop no longer moves its landing. Landing a leap, the foot comes down at `TOUCH` of the body's fall.
 */
const ROLL = 0.1, BEND = 0.15, PIVOT = 0.03, RISING = 0.5, LOWEST = 0.12, RISE = { accel: 20 }, LANDING = { drop: 0.06, least: 0.15 }, PACE = 1, SETTLE = 0.8, TOUCH = 0.85;
/**
 * Tuned leap: the dip and push before take-off (s; recalled: games leave the floor within ~0.1 s of
 * the press); how far below standing the feet meet the floor (m); the knees taking the landing over
 * `down` s, as deep as `depth` × the fall's speed × `down` (half that running), rising over `up` s.
 */
const JUMP = { launch: 0.1, contact: 0.02, down: 0.15, depth: 0.25, up: 0.3 };

/**
 * Legs under a root the scene drives (`move`, read every sub-step): the pelvis exactly over it,
 * facing its yaw (within `PELVIS_TURN` of a planted foot), bobbing with the steps and let down by
 * `crouch`; each foot stays where it stands until it falls too far from its home under its hip
 * (or is turned too far from it), then steps — after the leg before it in the gait, with a flight running — to
 * where its home will be as it lands: re-aimed through the first half of the swing, frozen after;
 * heel first, rolling flat. Asked to `jump`, the legs dip, push off, follow the body's ballistic arc
 * (the root steering it over the floor) and land it, the knees taking up the fall.
 */
export class Stepper {
  readonly legs: Leg[];
  /** the pelvis' facing (rad), how far it walks and runs (0 … 1), the gait's phase (rad), the stance's duration (s); still and squared up; off the floor (a leap's flight) */
  yaw: number; moving = 0; run = 0; phase = 0; Ts = 1; settled = true; airborne = false;
  private readonly before: number[]; private readonly gap: number[]; private readonly yaws: number[];
  private asked: number | undefined; private stand = NaN; private last: number; private rootYaw: number;
  private readonly jumping: Leap = { phase: 'ground', since: 0, speed: 0, land: 0, bottom: 0, rise: 0, vy: 0, a: 0 };
  private readonly heights = [0, 0]; private readonly velocity = new Vector3(); private poses: (FootPose | null)[] = [];

  constructor(private readonly st: Stepping, private readonly feet: Feet, at: readonly { position: Vector3; yaw: number }[], yaw: number) {
    this.legs = at.map((foot, i) => ({ i, sign: feet.legs[i].sign, anchor: foot.position.clone(), yaw: foot.yaw, pitch: 0, heel: true, free: true, planted: 1, lifted: 1, strike: 0, landed: false, swing: null }));
    const mod = (x: number) => ((x % 1) + 1) % 1;
    this.before = st.offsets.map((o, i) => st.offsets.reduce((best, p, j) => j !== i && (best < 0 || mod(o - p) < mod(o - st.offsets[best])) ? j : best, -1));
    this.gap = st.offsets.map((o, i) => mod(o - st.offsets[this.before[i]]));
    this.yaw = this.last = this.rootYaw = yaw;
    this.yaws = [yaw, yaw];
  }

  /** Ask for a leap at `speed` (m/s up): taken up on the next sub-step standing or rising from a landing. */
  jump(speed: number) { this.asked = speed; }

  /** Step for this sub-step under `r` and set the root's position; the swinging feet's poses are planned now, the planted ones by `pose` once the hips are placed. */
  move(f: Frame<unknown>, r: DrivenRoot) {
    const { st, feet, legs, jumping: jump, yaws, heights, velocity, before } = this, s = st.scale, toeOut = st.toeOut, dt = f.dt;
    if (Number.isNaN(this.stand)) this.stand = heights[0] = heights[1] = f.prev.position(0).y;
    const v = Math.hypot(r.velocity.x, r.velocity.z);
    // (crouched: lower, the feet wider and a little ahead of the hips — the hips sit back — shorter, lower steps)
    const k = minimumJerk(clamp(r.crouch ?? 0, 0, 1));
    // (the pelvis' own rise and fall: a leap's dip, flight and landing)
    leap(jump, this.asked, smoothstep(st.run[0], st.run[1], v), s, dt);
    this.asked = undefined;
    const { rise, vy } = jump, air = jump.phase === 'air' ? Math.max(0, jump.land - jump.since) : jump.phase === 'landed' ? 0 : undefined, airborne = air !== undefined;
    this.airborne = airborne;
    // (where the root will be `ahead` s on, its speed changing as it does now: how far a hard stop or turn leaves a landing)
    const accel = _accel.subVectors(r.velocity, velocity).divideScalar(dt);
    velocity.copy(r.velocity);
    const travel = (ahead: number, out: Vector3) => out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(accel, ahead * ahead / 2);
    const forward = forwardOf(yaws[1]), left = leftOf(yaws[1]);
    const run = smoothstep(st.run[0], st.run[1], v);
    const wanted = yaws[1] + wrapAngle(r.yaw - yaws[1]);
    // (the root's turn rate, to foresee its facing as a foot lands)
    const spin = clamp(wrapAngle(r.yaw - this.rootYaw) / dt, -SPIN, SPIN);
    this.rootYaw = r.yaw;
    // the stance's duration (quicker turning), its travel kept within reach in the direction of travel
    let C = 2 / (st.cadence.base + st.cadence.perSpeed * Math.max(v, TURNING * s * (Math.abs(spin) + Math.abs(wanted - yaws[1]))));
    const along = v > 1e-6 ? r.velocity.dot(forward) / v : 1, across = v > 1e-6 ? r.velocity.dot(left) / v : 0;
    const duty = lerp(lerp(st.duty.walk, st.duty.side, Math.abs(across)), st.duty.run, run);
    const most = (1 - st.crouch.travel * k) * s / Math.hypot(along / (along > 0 ? lerp(st.travel.forward, st.travel.run, run) : st.travel.back), across / st.travel.side);
    if (v * duty * C > most) C = most / (v * duty);
    const Ts = duty * C, Tsw = C - Ts;
    const lead = Math.min(lerp(st.lead.share, st.lead.side, Math.abs(across)) * Ts, (lerp(st.lead.most, st.lead.run, run) * s) / Math.max(v, 1e-6));
    // the pelvis' facing: the root's, within reach of the feet's (as they stand or will land)
    let low = -Infinity, high = Infinity;
    for (const leg of legs) {
      const body = yaws[1] + wrapAngle(leg.yaw - leg.sign * toeOut - yaws[1]);
      [low, high] = [Math.max(low, body - PELVIS_TURN), Math.min(high, body + PELVIS_TURN)];
    }
    const goal = low <= high ? clamp(wanted, low, high) : (low + high) / 2;
    const rate = Math.abs(goal - this.last) / dt < 2 * TURN.speed ? (goal - this.last) / dt : 0;
    this.last = goal;
    const yaw = follow(yaws[0], yaws[1], goal, { ...TURN, velocity: rate }, dt);
    [yaws[0], yaws[1]] = [yaws[1], yaw];
    // side-stepping, the feet open wider and close in to the narrowest: their travel never crosses
    const widthAt = (speed: number) => Math.max(lerp(lerp(st.width.stand, st.width.walk * s, smoothstep(0, 1, speed)), st.width.run * s, smoothstep(st.run[0], st.run[1], speed)), (st.width.narrowest * s + Math.abs(across) * speed * Ts) / 2) + st.crouch.wider * s * k;
    const width = widthAt(v);
    const home = (leg: Leg, ahead: number, out: Vector3) => out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(leftOf(yaw), leg.sign * width).addScaledVector(forwardOf(yaw), st.crouch.ahead * s * k).setY(feet.ankleHeight);
    // the pelvis' height: let down walking, bobbing lowest after contact (running: mid-stance), as high as the feet reach
    const hip = (leg: Leg) => _hip.copy(r.position).addScaledVector(leftOf(yaw), leg.sign * feet.hip);
    const moving = smoothstep(0, 1, v);
    const standing = this.stand - st.crouch.depth * s * k;
    const nominal = () => standing + rise - (lerp(lerp(st.drop.walk, st.drop.side, Math.abs(across)), st.drop.run, run) + st.bob * lerp(1 - Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0)),
      Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / Ts)) ** 2), 0)), run)) * s * moving;
    // (a planted foot as far rolled as it may be; with the hip over it, no further than its strike's roll: there it changes ends)
    const rolled = (leg: Leg) => lerp(rollOf(leg), pivotLimit(leg), smoothstep(PIVOT * s, 2 * PIVOT * s, Math.abs(aheadOf(leg))));
    const reach = (leg: Leg, ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, rolled(leg), _a)) => {
      const at = hip(leg), horizontal = Math.hypot(ankle.x - at.x, ankle.z - at.z);
      return ankle.y + Math.sqrt(Math.max(0, (st.reach * feet.length) ** 2 - horizontal ** 2));
    };
    // the furthest from under its hip a foot lands (m)
    const landingReach = Math.max(LANDING.least * s, Math.sqrt(Math.max(0, (st.reach * feet.length) ** 2 - (Math.max(nominal() - LANDING.drop * s, standing - (LOWEST - LANDING.drop / 2) * s) - feet.ankleHeight) ** 2)));
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
        // (re-aimed through the first half of the swing in time, frozen after: but for a hard stop, pulling it back into reach till late)
        if (airborne || w.age < (1 - w.u) * w.T) [leg.anchor, leg.yaw] = landing(leg, (1 - w.u) * w.T);
        if (w.u < SETTLE && !airborne) settle(leg, w, w.age < (1 - w.u) * w.T);
        if (w.u >= 1 - 1e-9) [leg.swing, leg.planted, leg.landed, leg.strike, leg.leapt] = [null, 0, true, w.strike, !!w.rel];
      } else leg.planted += dt;
      leg.lifted += dt;
    }
    const off = (leg: Leg, ahead: number) => home(leg, ahead, _v).sub(leg.anchor).setY(0).length();
    // (still and no longer turned, the feet square up closer to the facing)
    const turn = lerp(STEP.squared, STEP.turn, smoothstep(0, 0.3, v + Math.abs(spin)));
    // (moving, a foot lifts its share of a cycle after the leg before it did: the steps stay even; standing, after a moment)
    const due = (leg: Leg) => moving > 0 ? legs[before[leg.i]].lifted >= C * this.gap[leg.i] || leg.planted >= Ts * DUE : leg.planted >= STEP.square;
    const wants = (leg: Leg) => (off(leg, lead) > (v > 0 || spin !== 0 || k > 0 ? STEP.distance : STEP.still) * s && due(leg)) || off(leg, lead) > Math.max(STEP.distance * s, DUE * v * Ts) || Math.abs(wrapAngle(leg.yaw - yaw - leg.sign * toeOut)) > turn;
    for (const leg of [...legs].sort((a, b) => off(b, lead) - off(a, lead))) {
      const other = legs[before[leg.i]];
      // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
      const otherLands = other.swing ? (1 - other.swing.u) * other.swing.T : -other.planted;
      // (a foot about to be out of reach, or under the body, steps at once, the other in the air or not)
      // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
      const urgent = airborne ? !leg.swing && air > 0 : reach(leg) < nominal() + Math.max(0, vy) * RISING - STEP.short * s || _v.subVectors(hip(leg), leg.anchor).dot(leftOf(yaw)) * leg.sign > STEP.medial * s || aheadOf(leg) > most;
      if (airborne && !urgent) continue;
      // (a foot lands before it lifts again, unless it would be out of reach: not in the sub-step it touches down)
      if (leg.swing || !(urgent || (!leg.landed && wants(leg) && otherLands + Ts - C * this.gap[leg.i] <= 1e-9))) continue;
      // (a foot that would have to cross the other, or will be nearer its home than the other a swing on, lets the other step first)
      if (!urgent && !other.swing && !airborne && (landing(leg, Tsw - dt)[2] > BLOCKED * s || off(other, lead + Tsw) > off(leg, lead + Tsw) + STEP.distance * s)) continue;
      const bone = feet.legs[leg.i].foot;
      const x = f.prev.position(bone).clone(), velocity = x.clone().sub(f.prev2.position(bone)).divideScalar(dt);
      const toes = f.prev.local(feet.legs[leg.i].toes).clone();
      const T = airborne ? air + dt : Tsw;
      leg.swing = { u: dt / T, age: dt, rest: T, T, x, v: velocity, a: new Vector3(), fromYaw: leg.yaw, fromPitch: leg.pitch, toes, strike: 0,
        lift: (airborne ? st.lift.jump : lerp(st.lift.walk, st.lift.run, run) * (1 - st.crouch.lift * k)) * s, run, rel: null };
      [leg.anchor, leg.yaw] = landing(leg, T - dt);
      settle(leg, leg.swing);
      this.phase = 2 * Math.PI * st.offsets[leg.i];
      leg.lifted = 0;
    }
    /** a landing kept within reach of the hip as it will be (a hard stop pulls it in), heel first only ahead of it */
    function settle(leg: Leg, w: Swing, aiming = true) {
      const at = travel((1 - w.u) * w.T, _v).addScaledVector(leftOf(yaw), leg.sign * feet.hip);
      const out = _b.subVectors(leg.anchor, at).setY(0);
      if (out.length() > landingReach) uncross(leg, leg.anchor.copy(at).add(out.setLength(landingReach)).setY(feet.ankleHeight), leftOf(leg.yaw - leg.sign * toeOut, _l));
      if (aiming) w.strike = lerp(st.strike.walk, st.strike.run, run) * clamp(out.dot(forwardOf(leg.yaw)) / (st.strike.ahead * s), -1, 1);
    }
    function landing(leg: Leg, remaining: number): [Vector3, number, number] {
      // turned toward the root's facing, as far as the other foot lets the pelvis
      const other = legs[before[leg.i]];
      const body = other.yaw - other.sign * toeOut;
      const ahead = wanted + spin * (remaining + lead);
      const turned = other.swing ? ahead : body + clamp(wrapAngle(ahead - body), -PELVIS_TURN, PELVIS_TURN);
      const side = leftOf(turned, new Vector3());
      // (as wide as the speed it will land at: a stopping step lands in the standing stance)
      const then = _w.copy(r.velocity).addScaledVector(accel, remaining), speed = then.dot(r.velocity) > 0 ? Math.hypot(then.x, then.z) : 0;
      const to = new Vector3().copy(r.position).addScaledVector(r.velocity, remaining + lead).addScaledVector(side, leg.sign * widthAt(speed))
        .addScaledVector(forwardOf(turned, _f), st.crouch.ahead * s * k).setY(feet.ankleHeight);
      return [to, turned + leg.sign * toeOut, uncross(leg, to, side)];
    }
    /** `to` moved onto its own side of the other foot, as the body will face (`side`, its left) and as it faces now; how far it was across (m) */
    function uncross(leg: Leg, to: Vector3, side: Vector3): number {
      const other = legs[before[leg.i]];
      let across = 0;
      for (const axis of [side, leftOf(yaw, _m)]) {
        const gap = _v.subVectors(to, other.anchor).dot(axis) * leg.sign;
        if (gap < st.width.narrowest * s) to.addScaledVector(axis, leg.sign * (st.width.narrowest * s - gap));
        across = Math.max(across, st.width.narrowest * s - gap);
      }
      return across;
    }
    // the swinging ankles on their paths, the pelvis as high as the feet let it (in the air: where the root has it)
    // (in the air the pelvis' own height eases back up to the gait's, the root's rise on it)
    // (heights kept as if standing up: the crouch's own smooth lowering and raising is followed at once)
    const crouched = st.crouch.depth * s * k;
    const lifted = heights[1] - crouched + (Math.max(0, heights[1] - heights[0]) / dt + RISE.accel * dt) * dt;
    const flying = Math.min(nominal() - rise, lifted);
    this.poses = legs.map((leg) => leg.swing ? swingPose(leg) : null);
    let y = airborne ? flying + rise : nominal();
    // (a swinging foot holds the pelvis down only late in its swing: before, its leg just swings straighter)
    if (!airborne) legs.forEach((leg, i) => { y = softMin(y, reach(leg, this.poses[i]?.ankle) + (leg.swing ? LOWEST * s * (1 - minimumJerk((leg.swing.u - 0.5) / 0.3)) : 0), 0.004 * s); });
    // (let down at once as the feet need, up again no faster than `RISE`: a foot let go of does not pop the pelvis up)
    // (the root's own rise and fall are followed at once)
    const base = airborne ? flying : Math.min(Math.max(y - rise, standing - LOWEST * s), lifted);
    [heights[0], heights[1]] = [heights[1], base + crouched];
    y = base + rise;
    f.current.setRoot(_v.copy(r.position).setY(y));
    const stepping = legs.some((leg) => leg.swing);
    this.phase += Math.PI * dt / (C / 2) * Number(stepping);
    [this.yaw, this.moving, this.run, this.Ts] = [yaw, moving, run, Ts];
    this.settled = !(v > 0.05 || stepping) && legs.every((leg) => leg.planted > 0.4) && legs.every((leg) => !wants(leg));
    this.plant = (leg, at) => plantedPose(leg, at);

    /** a swinging foot: minimum jerk toward its landing (heel strike), the lift arc over it, clear of the floor */
    function swingPose(leg: Leg): FootPose {
      const w = leg.swing!, { foot: footBone, toes: toesBone, top } = feet.legs[leg.i];
      if (airborne && !w.rel) {
        // (taking to the air mid-step, the step starts over as the leap's, from where the foot is, moving as it does)
        const at = f.prev.position(footBone), was = f.prev2.position(footBone), hips = f.prev.position(0), hipsWas = f.prev2.position(0);
        w.rel = { x: hips.y - at.y, v: (hips.y - at.y - hipsWas.y + was.y) / dt, a: 0 };
        w.x.set(at.x - hips.x, at.y, at.z - hips.z);
        w.v.set(at.x - was.x - hips.x + hipsWas.x, at.y - was.y, at.z - was.z - hips.z + hipsWas.z).divideScalar(dt);
        w.a.set(0, 0, 0);
        [w.fromYaw, w.fromPitch, w.u, w.T, w.age, w.lift, w.run] = [w.fromYaw + wrapAngle(leg.yaw - w.fromYaw) * minimumJerk(w.u), leg.pitch, dt / w.rest, w.rest, dt, st.lift.jump * s, 0];
        w.toes.copy(f.prev.local(toesBone));
      }
      const u = w.u;
      // (landing as it will stand: heel up already where the shank will lean past the ankle's bend)
      const hipLands = _hipAt.copy(hip(leg)).addScaledVector(r.velocity, w.rest).setY(f.prev.position(top).y);
      const strike = w.strike - beyond(shankLean(hipLands, feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _a), leg.yaw) + w.strike - st.dorsiflexion) * minimumJerk((u - 0.5) / 0.5);
      const land = feet.ankle(leg.i, leg.anchor, leg.yaw, strike, new Vector3());
      if (airborne) for (const axis of ['x', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis] - r.position[axis] - r.velocity[axis] * air, -r.velocity[axis], w.rest, dt);
      else for (const axis of ['x', 'y', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis], 0, w.rest, dt);
      const yawNow = w.fromYaw + wrapAngle(leg.yaw - w.fromYaw) * minimumJerk(u);
      leg.pitch = w.fromPitch * (1 - minimumJerk(u / 0.45)) + strike * minimumJerk((u - 0.6) / 0.4);
      leg.pitch -= beyond(feet.lean(leg.i, f.prev, yawNow) + leg.pitch - st.dorsiflexion);
      const foot = feet.rotation(yawNow, leg.pitch, new Quaternion());
      // (the toes relax off the floor into line, and landing toes first come down flat)
      const toes = foot.clone().multiply(_q.copy(w.toes).slerp(IDENTITY, minimumJerk(u / 0.3)))
        .slerp(feet.rotation(yawNow, Math.max(0, leg.pitch), _toes), minimumJerk((u - 0.6) / 0.4));
      // (the arc peaks mid-swing walking; a runner's heel stays up later, the knee bent late into the swing)
      const a = lerp(3, st.arc, w.run), peak = a / (a + 3);
      const arc = w.lift * (u ** a * (1 - u) ** 3) / (peak ** a * (1 - peak) ** 3);
      const ankle = w.x.clone().setY(w.x.y + arc);
      if (airborne) {
        // (in the air the leg's length is planned, not the foot's height: hanging from the hips, tucked
        // between; landing, the foot comes down with the body, slowed a little by the knees bending)
        const rel = w.rel!, pelvis = flying + rise, falls = rise + vy * air - GRAVITY * air * air / 2;
        [rel.x, rel.v, rel.a] = quintic(rel.x, rel.v, rel.a, flying + falls - land.y, (1 - TOUCH) * (vy - GRAVITY * air), w.rest, dt);
        ankle.set(r.position.x + w.x.x, pelvis - rel.x + arc, r.position.z + w.x.z);
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
      const far = (pitch: number) => feet.ankle(leg.i, leg.anchor, leg.yaw, pitch, _a).distanceTo(at) > st.reach * feet.length;
      leg.free = !far(roll);
      let lo = roll, hi = leg.free ? roll : pivotLimit(leg);
      for (let k = 0; k < 24 && hi !== roll; k++) { const mid = (lo + hi) / 2; if (far(mid)) lo = mid; else hi = mid; }
      leg.pitch = hi;
      // (the heel lifts once the shank leans further over the foot than the ankle bends: deep in a crouch)
      leg.pitch -= beyond(shankLean(at, feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, _a), leg.yaw) + leg.pitch - st.dorsiflexion);
      const ankle = feet.ankle(leg.i, leg.anchor, leg.yaw, leg.pitch, new Vector3());
      return { ankle, foot: feet.rotation(leg.yaw, leg.pitch, new Quaternion()), toes: feet.rotation(leg.yaw, Math.max(0, leg.pitch), new Quaternion()), yaw: leg.yaw };
    }
    /** the most a planted foot rolls to help the hip reach it: onto its heel when it is ahead, its ball when behind */
    function pivotLimit(leg: Leg): number {
      // (it changes ends only while it needs no roll past its strike's: changed mid-roll, the roll would jump)
      if (leg.free) leg.heel = aheadOf(leg) < 0;
      // (just landed, it first rolls off its strike: the pivot is given over as the roll ends)
      return lerp(rollOf(leg), leg.heel ? st.pitch.heel : st.pitch.ball, minimumJerk(leg.planted / ROLL));
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

  private plant: (leg: Leg, at: Vector3) => FootPose = () => { throw new Error('pose before move'); };

  /** Leg `i`'s foot posed for this sub-step with its top joint at `top` (as the hips now stand); a swinging leg is never asked past its reach, where the knee's swivel is undefined. */
  pose(i: number, top: Vector3): FootPose {
    const leg = this.legs[i], st = this.st, length = this.feet.length;
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

/** how far `x` (rad) is past 0, easing in from `BEND`/2 before it (C¹: the heel starts lifting at rest) */
const beyond = (x: number) => x <= -BEND / 2 ? 0 : x < BEND / 2 ? (x + BEND / 2) ** 2 / (2 * BEND) : x;

/** a planted foot's roll off its strike (rad): flat after `ROLL` */
const rollOf = (leg: Leg) => leg.strike * (1 - minimumJerk(leg.planted / ROLL));

const IDENTITY = new Quaternion(), _q = new Quaternion(), _toes = new Quaternion();
const [_v, _w, _a, _b, _hip, _hipAt, _accel, _l, _f, _m, _d] = Array.from({ length: 11 }, () => new Vector3());
