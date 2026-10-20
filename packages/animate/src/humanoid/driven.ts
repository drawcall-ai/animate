// Game-style driven legs: the scene moves the root, the legs step to keep up.
// Recalled: the procedural stepping of games (e.g. Rain World, Overgrowth, Unreal "Control Rig"
// foot placement): each foot has a home under its hip; it steps when it falls too far from it,
// landing where the home will be.
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { solveChain } from '../core/chain';
import { follow } from '../core/follow';
import { live, type Behaviour, type Live } from '../core/goal';
import { clampRotation } from '../core/limits';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, pointSegmentDistance, quatYXZ, smoothstep, softMin, softplus, wrapAngle } from '../core/math';
import { quintic } from '../core/legs/swing';
import { TrackedRotation } from '../core/track';
import { createAsks, takeAsks } from '../core/asks';
import { ankleFor, ballOf, footRotation, heelOf } from './balance/foot';
import { shankTilt } from './balance/legs';
import { hullOf, outside } from './balance/support';
import { INDEX, SIDES, type Side } from './bones';
import type { Humanoid } from './humanoid';
import { solePoints } from './landmarks';
import { STANDING_REACH } from './balance/posture';
import { defaultStance } from './stance';

/**
 * The root a scene drives: its point on the floor, its velocity over it (m/s), its facing (rad
 * about +Y), and how far it crouches (0 standing … 1 a deep crouch). `jump`, set to a take-off
 * speed (m/s up), asks for a leap: the legs dip, push off, carry the body on its ballistic arc and
 * take the landing, clearing `jump` as they act on it; `airborne` is theirs to say (the scene's to
 * read: steering less in the air).
 */
export interface DrivenRoot {
  position: Vector3;
  velocity: Vector3;
  yaw: number;
  crouch?: number;
  jump?: number;
  airborne?: boolean;
}

// Recalled (Perry 1992; Novacheck 1998): walking duty 0.62, 1.4 m/s at ~110–120 steps/min;
// running at 3.5 m/s ~165 steps/min, ~0.25 s contact, a ~0.1 s flight. Tuned linear cadence through both.
const CADENCE = { base: 1.75, perSpeed: 0.3 };
// Tuned: side-stepping without a double support (no crossing at 1 m/s needs quick, open-and-close steps).
const DUTY = { walk: 0.62, side: 0.5, run: 0.32 };
const RUN = [2, 3] as const;
/** Tuned: the most the pelvis travels over one stance (m, default body), forward (walking, running), back and sideways: shorter, quicker steps where the leg reaches less. */
const TRAVEL = { forward: 0.85, run: 0.75, back: 0.6, side: 0.3 };
/** Tuned: a foot lands this share of its stance travel ahead of its hip (forward, sideways), at most this far (m; running nearer under it). */
const LEAD = { share: 0.4, side: 0.5, most: 0.3, run: 0.22 };
/** Tuned: moving, a foot that has stood this many stances, or is this many stances' travel off its home, lifts whatever the other does. */
const DUE = 1.5;
/**
 * Tuned: a foot steps once it is due (half a cycle after the other lifted; standing, after `square` s) and is this far
 * (m; standing still and upright: `still`, the stance squared up evenly) off its home, or is `DUE` stances' travel off it, or turned this much (rad; still: `squared`) off it; once it would hold the pelvis this far (m)
 * below its height, or is this far (m) in from its hip under the body, or a whole stance's travel behind it, it steps at once.
 */
const STEP = { distance: 0.06, still: 0.02, turn: (25 * Math.PI) / 180, squared: (2 * Math.PI) / 180, short: 0.03, square: 0.2, medial: 0.1 };
/** Tuned: the pelvis turns at most this far from a planted foot's facing (rad); the trunk and gaze take the rest. */
const PELVIS_TURN = (50 * Math.PI) / 180;
/** Tuned: half the heel-to-heel width walking and running (m); never closer across than `NARROWEST`. */
const WIDTH = { walk: 0.09, run: 0.07 };
const NARROWEST = 0.1;
/** Tuned: a step that would end this far (m) across the other foot waits for the other to step first. */
const BLOCKED = 0.05;
/** Requested: 3–4 cm pelvis bob peak to peak, lowest after contact; walking forward the stance leg is near straight at mid-stance (Perry: ~5–10°), side-stepping and running lower for the leg's reach (m, tuned). */
const BOB = 0.035;
const DROP = { walk: 0, side: 0.03, run: 0.06 };
/** Requested: an 8–12 cm lift arc walking (tuned: a runner's heel kicks higher); the heel strikes toes-up (rad; toes first landing behind the hip, tuned full this far ahead, m) and rolls flat in 0.1 s (recalled: ~10–15°, Perry 1992). */
const LIFT = { walk: 0.09, run: 0.25, jump: 0.2 };
/** Tuned: landing a leap, the foot comes down at this share of the body's fall (the knees bend from before contact). */
const TOUCH = 0.85;
const STRIKE = { walk: 0.2, run: 0.08, ahead: 0.15 };
const ROLL = 0.1;
/** Recalled: the ankle dorsiflexes ~35–40° at most (rad; a deep squat's limit, kept below the rig's 40°). */
const DORSIFLEXION = 0.6;
/** Tuned: over how much of a lean past it (rad) the heel's lift eases in. */
const BEND = 0.15;
/**
 * Tuned crouch (at 1, default body): the pelvis this much lower (m), the feet this much wider and this
 * far ahead of the hips (m: the hips sit back, so the shanks stay within the ankle's bend), the trunk
 * leaning forward (rad); stance travel and foot lift this share shorter.
 */
const CROUCH = { depth: 0.37, wider: 0.04, ahead: 0.14, lean: 0.3, travel: 0.4, lift: 0.5 };
/** Tuned: a runner's lift arc ∝ u^ARC (1 − u)³, peaking at 60% of the swing (walking: u³ (1 − u)³). */
const ARC = 4.5;
/** The leg's reach (× length): standing's; the most a planted foot rolls onto its heel (+) and ball (−) to keep it (rad, tuned). */
const REACH = STANDING_REACH;
/** Tuned: a root rising (getting up from a landing) asks this much sooner for a foot out of reach (s): it steps before its leg goes straight. */
const RISING = 0.5;
/** Tuned: a swinging leg's reach eases off from here (× length) to `REACH`. */
const SWING_REACH = 0.97;
/** Tuned: the most the feet let the pelvis down below the stance (m): a foot past reach leaves the leg straight instead. */
const LOWEST = 0.12;
/** Tuned: how fast the pelvis may speed up taking up its height again (m/s²). */
const RISE = { accel: 20 };
/** Tuned: a landing is kept within the leg's reach with the pelvis let down this much more (m); never nearer than `least` (m). */
const LANDING = { drop: 0.06, least: 0.15 };
/**
 * Tuned leap: the dip and push before take-off (s; recalled: games leave the floor within ~0.1 s of
 * the press); how far below standing the feet meet the floor (m); the knees taking the landing over
 * `down` s, as deep as `depth` × the fall's speed × `down` (half that running), rising over `up` s.
 */
const JUMP = { launch: 0.1, contact: 0.02, down: 0.15, depth: 0.25, up: 0.3 };
type Leap = { phase: 'ground' | 'launch' | 'air' | 'landed' | 'down' | 'up'; since: number; speed: number; land: number; bottom: number; rise: number; vy: number; a: number };
/** Tuned: how fast a swing's duration may grow with the gait's (s/s). */
const PACE = 1;
/** Tuned: the share of a swing after which even a hard stop no longer moves its landing. */
const SETTLE = 0.8;
const PITCH = { heel: 0.35, ball: -0.95 };
/** Tuned: within this far (m) of being over a planted foot, the hip lets it settle flat to change the end it rolls on. */
const PIVOT = 0.03;
/** Tuned: sole clearance mid-swing (m); how fast the pelvis turn (rad/s²) and the trunk (rad/s²) follow. */
const CLEARANCE = 0.015;
const TURN = { accel: 80, speed: 8 };
/** Tuned: the most root turn rate (rad/s) a landing foresees. */
const SPIN = 1.5;
/** Tuned: turning steps as quick as walking this fast per rad/s turned or rad behind (m). */
const TURNING = 0.5;
const TRUNK = { accel: 60 };
const RUN_LEAN = 0.12;
/** Recalled (CMU mocap, as the balance posture has it): the trunk nods ~±1.2° walking, ~±3° running (rad, peak). */
const NOD = { walk: 0.06, run: 0.09 };
/** Recalled: anterior pelvic tilt grows with speed (~5° walking, ~15° running; Novacheck 1998); tuned: changing within `accel` (rad/s²). */
const TILT = { walk: 0.06, run: 0.25, accel: 8 };
/** Development bounds: planted pivot slide (m), touchdown speeds (m/s), closest shanks (m, ~their thickness), logged-only XCoM (m). */
const LIMIT = { slide: 0.001, vertical: 0.1, horizontal: 1, across: 0.06, xcom: 0.1 };

interface Swing { u: number; age: number; rest: number; T: number; x: Vector3; v: Vector3; a: Vector3; fromYaw: number; fromPitch: number; toes: Quaternion; strike: number; lift: number; run: number; rel: { x: number; v: number; a: number } | null }
interface Leg { leapt?: boolean; side: Side; sign: 1 | -1; anchor: Vector3; yaw: number; pitch: number; heel: boolean; free: boolean; planted: number; lifted: number; strike: number; landed: boolean; swing: Swing | null }

/**
 * Legs under a root the scene drives (`root`, read every sub-step): the pelvis exactly over it,
 * facing its yaw (within `PELVIS_TURN` of a planted foot), bobbing with the steps and let down by
 * `crouch`; each foot stays where it stands until it falls too far from its home under its hip
 * (or is turned too far from it), then steps — alternately walking, with a flight running — to
 * where its home will be as it lands: re-aimed through the first half of the swing, frozen after;
 * heel first, rolling flat. Asked to `jump`, the legs dip, push off, follow the body's ballistic arc
 * (the root steering it over the floor) and land it, the knees taking up the fall. The trunk takes
 * `h.asks.bow` and `twist`; the pelvis' height is the legs' own (`crouch`, a leap): `lower` is not taken.
 * Development checks: planted slide, touchdown speed, feet across; the XCoM is only noted.
 */
export function driven<W>(h: Humanoid<W>, root: Live<DrivenRoot, W>): Behaviour<W> {
  return function* () {
    const p = h.proportions, s = p.scale;
    const toeOut = defaultStance(p).toeOut;
    const asks = createAsks();
    const legs: Leg[] = SIDES.map((side, i) => ({ side, sign: i === 0 ? 1 : -1, anchor: h.feet[i].position.clone(), yaw: h.feet[i].yaw, pitch: 0, heel: true, free: true, planted: 1, lifted: 1, strike: 0, landed: false, swing: null }));
    const trunk = [new TrackedRotation(), new TrackedRotation()];
    let stand = NaN, last = h.yaw, phase = 0, rootYaw = h.yaw;
    const jump: Leap = { phase: 'ground', since: 0, speed: 0, land: 0, bottom: 0, rise: 0, vy: 0, a: 0 };
    const yaws = [h.yaw, h.yaw], heights = [0, 0], tilts = [0, 0], velocity = new Vector3();
    yield* action<Frame<W>>({ update: (f) => {
      if (f.dev && f.time > f.dt) check(h, f, legs);
      const dt = f.dt;
      takeAsks(h.asks, asks);
      const r = live(root, f);
      if (Number.isNaN(stand)) stand = heights[0] = heights[1] = f.prev.position(0).y;
      const v = Math.hypot(r.velocity.x, r.velocity.z);
      // (crouched: lower, the feet wider and a little ahead of the hips — the hips sit back — shorter, lower steps)
      const k = minimumJerk(clamp(r.crouch ?? 0, 0, 1));
      // (the pelvis' own rise and fall: a leap's dip, flight and landing)
      leap(jump, r, smoothstep(RUN[0], RUN[1], v), s, dt);
      const { rise, vy } = jump, air = jump.phase === 'air' ? Math.max(0, jump.land - jump.since) : jump.phase === 'landed' ? 0 : undefined, airborne = air !== undefined;
      r.airborne = airborne;
      // (where the root will be `ahead` s on, its speed changing as it does now: how far a hard stop or turn leaves a landing)
      const accel = _accel.subVectors(r.velocity, velocity).divideScalar(dt);
      velocity.copy(r.velocity);
      const travel = (ahead: number, out: Vector3) => out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(accel, ahead * ahead / 2);
      const forward = forwardOf(yaws[1]), left = leftOf(yaws[1]);
      const run = smoothstep(RUN[0], RUN[1], v);
      const wanted = yaws[1] + wrapAngle(r.yaw - yaws[1]);
      // (the root's turn rate, to foresee its facing as a foot lands)
      const spin = clamp(wrapAngle(r.yaw - rootYaw) / dt, -SPIN, SPIN);
      rootYaw = r.yaw;
      // the stance's duration (quicker turning), its travel kept within reach in the direction of travel
      let C = 2 / (CADENCE.base + CADENCE.perSpeed * Math.max(v, TURNING * s * (Math.abs(spin) + Math.abs(wanted - yaws[1]))));
      const along = v > 1e-6 ? r.velocity.dot(forward) / v : 1, across = v > 1e-6 ? r.velocity.dot(left) / v : 0;
      const duty = lerp(lerp(DUTY.walk, DUTY.side, Math.abs(across)), DUTY.run, run);
      const most = (1 - CROUCH.travel * k) * s / Math.hypot(along / (along > 0 ? lerp(TRAVEL.forward, TRAVEL.run, run) : TRAVEL.back), across / TRAVEL.side);
      if (v * duty * C > most) C = most / (v * duty);
      const Ts = duty * C, Tsw = C - Ts;
      const lead = Math.min(lerp(LEAD.share, LEAD.side, Math.abs(across)) * Ts, (lerp(LEAD.most, LEAD.run, run) * s) / Math.max(v, 1e-6));
      // the pelvis' facing: the root's, within reach of the feet's (as they stand or will land)
      let low = -Infinity, high = Infinity;
      for (const leg of legs) {
        const body = yaws[1] + wrapAngle(leg.yaw - leg.sign * toeOut - yaws[1]);
        [low, high] = [Math.max(low, body - PELVIS_TURN), Math.min(high, body + PELVIS_TURN)];
      }
      const goal = low <= high ? clamp(wanted, low, high) : (low + high) / 2;
      const rate = Math.abs(goal - last) / dt < 2 * TURN.speed ? (goal - last) / dt : 0;
      last = goal;
      const yaw = follow(yaws[0], yaws[1], goal, { ...TURN, velocity: rate }, dt);
      [yaws[0], yaws[1]] = [yaws[1], yaw];
      // side-stepping, the feet open wider and close in to the narrowest: their travel never crosses
      const widthAt = (speed: number) => Math.max(lerp(lerp(defaultStance(p).width, WIDTH.walk * s, smoothstep(0, 1, speed)), WIDTH.run * s, smoothstep(RUN[0], RUN[1], speed)), (NARROWEST * s + Math.abs(across) * speed * Ts) / 2) + CROUCH.wider * s * k;
      const width = widthAt(v);
      const home = (leg: Leg, ahead: number, out: Vector3) => out.copy(r.position).addScaledVector(r.velocity, ahead).addScaledVector(leftOf(yaw), leg.sign * width).addScaledVector(forwardOf(yaw), CROUCH.ahead * s * k).setY(p.ankleHeight);
      // the pelvis' height: let down walking, bobbing lowest after contact (running: mid-stance), as high as the feet reach
      const hip = (leg: Leg) => _hip.copy(r.position).addScaledVector(leftOf(yaw), leg.sign * p.hipHalfWidth);
      const moving = smoothstep(0, 1, v);
      const standing = stand - CROUCH.depth * s * k;
      const nominal = () => standing + rise - (lerp(lerp(DROP.walk, DROP.side, Math.abs(across)), DROP.run, run) + BOB * lerp(1 - Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? Math.sin(Math.PI * leg.swing.u) ** 2 : 0), 0)),
        Math.min(1, legs.reduce((sum, leg) => sum + (leg.swing ? 0 : Math.sin(Math.PI * Math.min(1, leg.planted / Ts)) ** 2), 0)), run)) * s * moving;
      // (a planted foot as far rolled as it may be; with the hip over it, no further than its strike's roll: there it changes ends)
      const rolled = (leg: Leg) => lerp(rollOf(leg), pivotLimit(leg), smoothstep(PIVOT * s, 2 * PIVOT * s, Math.abs(aheadOf(leg))));
      const reach = (leg: Leg, ankle = ankleFor(p, leg.side, leg.anchor, leg.yaw, rolled(leg), _a)) => {
        const at = hip(leg), horizontal = Math.hypot(ankle.x - at.x, ankle.z - at.z);
        return ankle.y + Math.sqrt(Math.max(0, (REACH * p.legLength) ** 2 - horizontal ** 2));
      };
      // the furthest from under its hip a foot lands (m)
      const landingReach = Math.max(LANDING.least * s, Math.sqrt(Math.max(0, (REACH * p.legLength) ** 2 - (Math.max(nominal() - LANDING.drop * s, standing - (LOWEST - LANDING.drop / 2) * s) - p.ankleHeight) ** 2)));
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
      // (moving, a foot lifts half a cycle after the other did: the steps stay even; standing, after a moment)
      const due = (leg: Leg) => moving > 0 ? legs[leg.sign === 1 ? 1 : 0].lifted >= C / 2 || leg.planted >= Ts * DUE : leg.planted >= STEP.square;
      const wants = (leg: Leg) => (off(leg, lead) > (v > 0 || spin !== 0 || k > 0 ? STEP.distance : STEP.still) * s && due(leg)) || off(leg, lead) > Math.max(STEP.distance * s, DUE * v * Ts) || Math.abs(wrapAngle(leg.yaw - yaw - leg.sign * toeOut)) > turn;
      for (const leg of [...legs].sort((a, b) => off(b, lead) - off(a, lead))) {
        const other = legs[leg.sign === 1 ? 1 : 0];
        // alternate: lift once the other foot has stood (walking) or before it lands (running, a flight)
        const otherLands = other.swing ? (1 - other.swing.u) * other.swing.T : -other.planted;
        // (a foot about to be out of reach, or under the body, steps at once, the other in the air or not)
        // (leaping, the feet leave the floor as the body does: the legs pushed off during the launch)
        const urgent = airborne ? !leg.swing && air > 0 : reach(leg) < nominal() + Math.max(0, vy) * RISING - STEP.short * s || _v.subVectors(hip(leg), leg.anchor).dot(leftOf(yaw)) * leg.sign > STEP.medial * s || aheadOf(leg) > most;
        if (airborne && !urgent) continue;
        // (a foot lands before it lifts again, unless it would be out of reach: not in the sub-step it touches down)
        if (leg.swing || !(urgent || (!leg.landed && wants(leg) && otherLands + Ts - C / 2 <= 1e-9))) continue;
        // (a foot that would have to cross the other, or will be nearer its home than the other a swing on, lets the other step first)
        if (!urgent && !other.swing && !airborne && (landing(leg, Tsw - dt)[2] > BLOCKED * s || off(other, lead + Tsw) > off(leg, lead + Tsw) + STEP.distance * s)) continue;
        const bone = INDEX[`${leg.side}Foot`];
        const x = f.prev.position(bone).clone(), velocity = x.clone().sub(f.prev2.position(bone)).divideScalar(dt);
        const toes = f.prev.local(INDEX[`${leg.side}Toes`]).clone();
        const T = airborne ? air + dt : Tsw;
        leg.swing = { u: dt / T, age: dt, rest: T, T, x, v: velocity, a: new Vector3(), fromYaw: leg.yaw, fromPitch: leg.pitch, toes, strike: 0,
          lift: (airborne ? LIFT.jump : lerp(LIFT.walk, LIFT.run, run) * (1 - CROUCH.lift * k)) * s, run, rel: null };
        [leg.anchor, leg.yaw] = landing(leg, T - dt);
        settle(leg, leg.swing);
        phase = leg.sign === 1 ? 0 : Math.PI;
        leg.lifted = 0;
      }
      /** a landing kept within reach of the hip as it will be (a hard stop pulls it in), heel first only ahead of it */
      function settle(leg: Leg, w: Swing, aiming = true) {
        const at = travel((1 - w.u) * w.T, _v).addScaledVector(leftOf(yaw), leg.sign * p.hipHalfWidth);
        const out = _b.subVectors(leg.anchor, at).setY(0);
        if (out.length() > landingReach) uncross(leg, leg.anchor.copy(at).add(out.setLength(landingReach)).setY(p.ankleHeight), leftOf(leg.yaw - leg.sign * toeOut, _l));
        if (aiming) w.strike = lerp(STRIKE.walk, STRIKE.run, run) * clamp(out.dot(forwardOf(leg.yaw)) / (STRIKE.ahead * s), -1, 1);
      }
      function landing(leg: Leg, remaining: number): [Vector3, number, number] {
        // turned toward the root's facing, as far as the other foot lets the pelvis
        const other = legs[leg.sign === 1 ? 1 : 0];
        const body = other.yaw - other.sign * toeOut;
        const ahead = wanted + spin * (remaining + lead);
        const turned = other.swing ? ahead : body + clamp(wrapAngle(ahead - body), -PELVIS_TURN, PELVIS_TURN);
        const side = leftOf(turned, new Vector3());
        // (as wide as the speed it will land at: a stopping step lands in the standing stance)
        const then = _w.copy(r.velocity).addScaledVector(accel, remaining), speed = then.dot(r.velocity) > 0 ? Math.hypot(then.x, then.z) : 0;
        const to = new Vector3().copy(r.position).addScaledVector(r.velocity, remaining + lead).addScaledVector(side, leg.sign * widthAt(speed))
          .addScaledVector(forwardOf(turned, _f), CROUCH.ahead * s * k).setY(p.ankleHeight);
        return [to, turned + leg.sign * toeOut, uncross(leg, to, side)];
      }
      /** `to` moved onto its own side of the other foot, as the body will face (`side`, its left) and as it faces now; how far it was across (m) */
      function uncross(leg: Leg, to: Vector3, side: Vector3): number {
        const other = legs[leg.sign === 1 ? 1 : 0];
        let across = 0;
        for (const axis of [side, leftOf(yaw, _m)]) {
          const gap = _v.subVectors(to, other.anchor).dot(axis) * leg.sign;
          if (gap < NARROWEST * s) to.addScaledVector(axis, leg.sign * (NARROWEST * s - gap));
          across = Math.max(across, NARROWEST * s - gap);
        }
        return across;
      }
      // the swinging ankles on their paths, the pelvis as high as the feet let it (in the air: where the root has it)
      // (in the air the pelvis' own height eases back up to the gait's, the root's rise on it)
      // (heights kept as if standing up: the crouch's own smooth lowering and raising is followed at once)
      const crouched = CROUCH.depth * s * k;
      const lifted = heights[1] - crouched + (Math.max(0, heights[1] - heights[0]) / dt + RISE.accel * dt) * dt;
      const flying = Math.min(nominal() - rise, lifted);
      const poses = legs.map((leg) => leg.swing ? swingPose(leg) : null);
      let y = airborne ? flying + rise : nominal();
      // (a swinging foot holds the pelvis down only late in its swing: before, its leg just swings straighter)
      if (!airborne) legs.forEach((leg, i) => { y = softMin(y, reach(leg, poses[i]?.ankle) + (leg.swing ? LOWEST * s * (1 - minimumJerk((leg.swing.u - 0.5) / 0.3)) : 0), 0.004 * s); });
      // (let down at once as the feet need, up again no faster than `RISE`: a foot let go of does not pop the pelvis up)
      // (the root's own rise and fall are followed at once)
      const base = airborne ? flying : Math.min(Math.max(y - rise, standing - LOWEST * s), lifted);
      [heights[0], heights[1]] = [heights[1], base + crouched];
      y = base + rise;
      f.current.setRoot(_v.copy(r.position).setY(y));
      // the pelvis tipped forward with the stride (room for the hip to extend behind), the trunk leaning on it as asked
      // (taken up and given up within an acceleration: a hard start or stop does not jerk the trunk)
      const tilt = follow(tilts[0], tilts[1], lerp(TILT.walk * moving, TILT.run, run), { accel: TILT.accel }, dt);
      [tilts[0], tilts[1]] = [tilts[1], tilt];
      f.current.setLocal(0, quatYXZ(yaw, tilt, 0, _q));
      // (the trunk nods forward as each foot takes the weight, about its landing: continuous as feet lift and land)
      const nod = lerp(NOD.walk, NOD.run, run) * moving * legs.reduce((sum, leg) => sum + 1 - Math.sin(Math.PI * (leg.swing ? leg.swing.u : Math.min(1, leg.planted / Ts))) ** 2, 0) / 2;
      const bend = quatYXZ(Math.max(-0.8, Math.min(0.8, asks.twist)), asks.bow + RUN_LEAN * run + CROUCH.lean * k - tilt + nod, 0, _bend).slerp(IDENTITY, 0.5);
      [INDEX.spine, INDEX.chest].forEach((bone, k) => {
        const local = _local.copy(bend), limit = f.current.skeleton.limits[bone];
        if (limit) clampRotation(local, limit);
        const followed = trunk[k].follow(f.prev2.local(bone), f.prev.local(bone), local, TRUNK, dt, _q);
        if (limit) clampRotation(followed, limit);
        f.current.setLocal(bone, followed);
      });
      // the legs down to the feet
      legs.forEach((leg, i) => {
        const thigh = f.current.position(INDEX[`${leg.side}UpperLeg`]);
        const pose = poses[i] ?? plantedPose(leg, thigh);
        // (a swinging leg is never asked past its reach, where the knee's swivel is undefined; landing, the pelvis is low enough)
        const d = _d.subVectors(pose.ankle, thigh), l = d.length(), from = SWING_REACH * p.legLength, span = (REACH - SWING_REACH) * p.legLength;
        if (leg.swing && l > from) pose.ankle.lerp(_a.copy(thigh).addScaledVector(d, (from + span * Math.tanh((l - from) / span)) / l), airborne ? 1 : 1 - minimumJerk((leg.swing.u - 0.8) / 0.15));
        const pole = _pole.copy(thigh).add(pose.ankle).multiplyScalar(0.5).addScaledVector(forwardOf(pose.yaw), 0.5);
        // (planted, the leg turns as the foot needs; swinging, the knee bends toward the pole and the foot turns within the ankle's range, so the knee never swivels to suit it)
        solveChain(f, `${leg.side}Leg`, { tip: { position: pose.ankle, quaternion: leg.swing ? undefined : pose.foot }, pole });
        const ankle = _local.copy(f.current.rotation(INDEX[`${leg.side}LowerLeg`])).invert().multiply(pose.foot);
        const ankleRange = f.current.skeleton.limits[INDEX[`${leg.side}Foot`]];
        if (ankleRange) clampRotation(ankle, ankleRange);
        f.current.setLocal(INDEX[`${leg.side}Foot`], ankle);
        // (planted, the toes lie on the floor; swinging, they keep their own bend whatever the ankle's range left of the foot's turn)
        const toes = _local.copy(leg.swing ? pose.foot : f.current.rotation(INDEX[`${leg.side}Foot`])).invert().multiply(pose.toes);
        const range = f.current.skeleton.limits[INDEX[`${leg.side}Toes`]];
        if (range) clampRotation(toes, range);
        f.current.setLocal(INDEX[`${leg.side}Toes`], toes);
        h.feet[i].position.copy(leg.anchor);
        h.feet[i].yaw = leg.yaw;
        h.feet[i].phase = leg.swing ? 'swing' : 'planted';
      });
      const g = h.locomotion, stepping = legs.some((leg) => leg.swing);
      phase += Math.PI * dt / (C / 2) * Number(stepping);
      [g.phase, g.walk, g.run, g.facing, g.facingAhead, g.moving, g.thoraxYaw] = [phase, moving, run, wrapAngle(yaw), wrapAngle(yaw), v > 0.05 || stepping, 0];
      g.velocity.copy(r.velocity).setY(0);
      g.planted = g.moving ? 0 : g.planted + dt;
      g.settled = !g.moving && legs.every((leg) => leg.planted > 0.4) && legs.every((leg) => !wants(leg));
      g.quiet.set(0, 0, 0);

      /** a swinging foot: minimum jerk toward its landing (heel strike), the lift arc over it, clear of the floor */
      function swingPose(leg: Leg): FootPose {
        const w = leg.swing!;
        if (airborne && !w.rel) {
          // (taking to the air mid-step, the step starts over as the leap's, from where the foot is, moving as it does)
          const bone = INDEX[`${leg.side}Foot`], at = f.prev.position(bone), was = f.prev2.position(bone), hips = f.prev.position(0), hipsWas = f.prev2.position(0);
          w.rel = { x: hips.y - at.y, v: (hips.y - at.y - hipsWas.y + was.y) / dt, a: 0 };
          w.x.set(at.x - hips.x, at.y, at.z - hips.z);
          w.v.set(at.x - was.x - hips.x + hipsWas.x, at.y - was.y, at.z - was.z - hips.z + hipsWas.z).divideScalar(dt);
          w.a.set(0, 0, 0);
          [w.fromYaw, w.fromPitch, w.u, w.T, w.age, w.lift, w.run] = [w.fromYaw + wrapAngle(leg.yaw - w.fromYaw) * minimumJerk(w.u), leg.pitch, dt / w.rest, w.rest, dt, LIFT.jump * s, 0];
          w.toes.copy(f.prev.local(INDEX[`${leg.side}Toes`]));
        }
        const u = w.u;
        // (landing as it will stand: heel up already where the shank will lean past the ankle's bend)
        const hipLands = _hipAt.copy(hip(leg)).addScaledVector(r.velocity, w.rest).setY(f.prev.position(INDEX[`${leg.side}UpperLeg`]).y);
        const strike = w.strike - beyond(shankLean(hipLands, ankleFor(p, leg.side, leg.anchor, leg.yaw, w.strike, _a), leg.yaw) + w.strike - DORSIFLEXION) * minimumJerk((u - 0.5) / 0.5);
        const land = ankleFor(p, leg.side, leg.anchor, leg.yaw, strike, new Vector3());
        if (airborne) for (const axis of ['x', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis] - r.position[axis] - r.velocity[axis] * air, -r.velocity[axis], w.rest, dt);
        else for (const axis of ['x', 'y', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis], 0, w.rest, dt);
        const yawNow = w.fromYaw + wrapAngle(leg.yaw - w.fromYaw) * minimumJerk(u);
        leg.pitch = w.fromPitch * (1 - minimumJerk(u / 0.45)) + strike * minimumJerk((u - 0.6) / 0.4);
        leg.pitch -= beyond(lean(leg.side, yawNow) + leg.pitch - DORSIFLEXION);
        const foot = footRotation(yawNow, leg.pitch, new Quaternion());
        // (the toes relax off the floor into line, and landing toes first come down flat)
        const toes = foot.clone().multiply(_q.copy(w.toes).slerp(IDENTITY, minimumJerk(u / 0.3)))
          .slerp(footRotation(yawNow, Math.max(0, leg.pitch), _toes), minimumJerk((u - 0.6) / 0.4));
        // (the arc peaks mid-swing walking; a runner's heel stays up later, the knee bent late into the swing)
        const a = lerp(3, ARC, w.run), top = a / (a + 3);
        const arc = w.lift * (u ** a * (1 - u) ** 3) / (top ** a * (1 - top) ** 3);
        const ankle = w.x.clone().setY(w.x.y + arc);
        if (airborne) {
          // (in the air the leg's length is planned, not the foot's height: hanging from the hips, tucked
          // between; landing, the foot comes down with the body, slowed a little by the knees bending)
          const rel = w.rel!, pelvis = flying + rise, falls = rise + vy * air - GRAVITY * air * air / 2;
          [rel.x, rel.v, rel.a] = quintic(rel.x, rel.v, rel.a, flying + falls - land.y, (1 - TOUCH) * (vy - GRAVITY * air), w.rest, dt);
          ankle.set(r.position.x + w.x.x, pelvis - rel.x + arc, r.position.z + w.x.z);
        }
        const low = Math.min(...soleOf(leg, ankle, foot, toes));
        const soft = 0.004 * Math.sin(Math.PI * u) ** 2 + Number.EPSILON;
        ankle.y += softplus(CLEARANCE * s * Math.sin(Math.PI * u) ** 3 - low, soft);
        return { ankle, foot, toes, yaw: yawNow };
      }
      /** how far the shank leans forward over a foot heading `yaw` (rad): as the last pose had it */
      function lean(side: Side, yaw: number): number {
        return shankTilt(f.prev, side, yaw);
      }
      /** a planted foot: rolling flat off its heel strike, onto its heel or ball as far as the hip needs to reach it */
      function plantedPose(leg: Leg, at: Vector3): FootPose {
        // (from the roll off the heel strike, on toward the pivot that brings the ankle nearer)
        const roll = rollOf(leg);
        const far = (pitch: number) => ankleFor(p, leg.side, leg.anchor, leg.yaw, pitch, _a).distanceTo(at) > REACH * p.legLength;
        leg.free = !far(roll);
        let lo = roll, hi = leg.free ? roll : pivotLimit(leg);
        for (let k = 0; k < 24 && hi !== roll; k++) { const mid = (lo + hi) / 2; if (far(mid)) lo = mid; else hi = mid; }
        leg.pitch = hi;
        // (the heel lifts once the shank leans further over the foot than the ankle bends: deep in a crouch)
        leg.pitch -= beyond(shankLean(at, ankleFor(p, leg.side, leg.anchor, leg.yaw, leg.pitch, _a), leg.yaw) + leg.pitch - DORSIFLEXION);
        const ankle = ankleFor(p, leg.side, leg.anchor, leg.yaw, leg.pitch, new Vector3());
        return { ankle, foot: footRotation(leg.yaw, leg.pitch, new Quaternion()), toes: footRotation(leg.yaw, Math.max(0, leg.pitch), new Quaternion()), yaw: leg.yaw };
      }
      /** the most a planted foot rolls to help the hip reach it: onto its heel when it is ahead, its ball when behind */
      function pivotLimit(leg: Leg): number {
        // (it changes ends only while it needs no roll past its strike's: changed mid-roll, the roll would jump)
        if (leg.free) leg.heel = aheadOf(leg) < 0;
        // (just landed, it first rolls off its strike: the pivot is given over as the roll ends)
        return lerp(rollOf(leg), leg.heel ? PITCH.heel : PITCH.ball, minimumJerk(leg.planted / ROLL));
      }
      function aheadOf(leg: Leg): number {
        return _v.subVectors(hip(leg), leg.anchor).dot(forwardOf(leg.yaw));
      }
      /** how far the shank leans forward over a foot heading `yaw` with the hip at `hip` and the ankle at `ankle`, the knee bent toward the toes (rad) */
      function shankLean(hip: Vector3, ankle: Vector3, yaw: number): number {
        const along = _b.subVectors(ankle, hip), l = along.length();
        along.divideScalar(l);
        const a = (p.thigh ** 2 - p.shin ** 2 + l * l) / (2 * l), rise = Math.sqrt(Math.max(0, p.thigh ** 2 - a * a));
        const fw = forwardOf(yaw, _f), side = _m.copy(fw).addScaledVector(along, -fw.dot(along)).normalize();
        const shin = _l.copy(hip).addScaledVector(along, a).addScaledVector(side, rise).sub(ankle);
        return Math.atan2(shin.dot(fw), shin.y);
      }
      function soleOf(leg: Leg, ankle: Vector3, foot: Quaternion, toes: Quaternion): number[] {
        const ball = ballOf(p, leg.side, _b).applyQuaternion(foot).add(ankle);
        return [heelOf(p, _a).applyQuaternion(foot).y + ankle.y,
          ...[p.sole.bigToe, p.sole.smallToe].map((tip) => _a.copy(tip).setX(tip.x * leg.sign).applyQuaternion(toes).y + ball.y)];
      }
    } });
  };
}

interface FootPose { ankle: Vector3; foot: Quaternion; toes: Quaternion; yaw: number }

/** A leap asked of the root (`jump`, its take-off speed) moved on `dt`: dipping, then in the air (landing on a sub-step), the knees taking it, rising again (`run`: 0 … 1 running; `s`: the body's scale). */
function leap(j: Leap, r: DrivenRoot, run: number, s: number, dt: number) {
  if (r.jump !== undefined && (j.phase === 'ground' || j.phase === 'up')) [j.phase, j.since, j.speed] = ['launch', 0, r.jump];
  r.jump = undefined;
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

/** Final-pose checks of the last sub-step, against the legs as they were posed then. */
function check<W>(h: Humanoid<W>, f: Frame<W>, legs: readonly Leg[]) {
  const dev = f.dev!, p = h.proportions, time = f.time - f.dt;
  legs.forEach((leg) => {
    const bone = INDEX[`${leg.side}Foot`];
    if (leg.swing) {
      const sink = -Math.min(...solePoints(h, f.prev, leg.side).map((at) => at.y));
      if (sink > 0.002) dev.append(time, { check: 'driven swing sole sink (m)', value: sink, limit: 0.002, where: `${leg.side}Foot` });
      return;
    }
    const pivots = leg.pitch > 0 ? [heelOf(p)] : leg.pitch < 0 ? [ballOf(p, leg.side)] : [heelOf(p), ballOf(p, leg.side)];
    for (const pivot of pivots) {
      const at = f.prev.point(bone, pivot, new Vector3());
      const slide = at.distanceTo(pivot.clone().applyQuaternion(footRotation(leg.yaw, 0)).add(leg.anchor));
      if (slide > LIMIT.slide) dev.append(time, { check: 'driven planted slide (m)', value: slide, limit: LIMIT.slide, where: `${leg.side}Foot` });
      if (!leg.landed) continue;
      const was = f.prev2.point(bone, pivot, new Vector3());
      const vertical = Math.abs(at.y - was.y) / f.dt, horizontal = Math.hypot(at.x - was.x, at.z - was.z) / f.dt;
      // (landing a leap the foot comes down with the body, the knees taking up the fall after: only its horizontal speed is bounded)
      if (vertical > LIMIT.vertical && !leg.leapt) dev.append(time, { check: 'driven touchdown vertical speed (m/s)', value: vertical, limit: LIMIT.vertical, where: `${leg.side}Foot` });
      if (horizontal > LIMIT.horizontal) dev.append(time, { check: 'driven touchdown horizontal speed (m/s)', value: horizontal, limit: LIMIT.horizontal, where: `${leg.side}Foot` });
    }
  });
  // (the shanks never closer than their thickness: legs that cross pass through each other)
  const shank = (side: Side) => [f.prev.position(INDEX[`${side}LowerLeg`]), f.prev.position(INDEX[`${side}Foot`])];
  const [l, r] = [shank('left'), shank('right')];
  const gap = Math.min(...[0, 0.25, 0.5, 0.75, 1].flatMap((k) => [
    pointSegmentDistance(new Vector3().lerpVectors(l[0], l[1], k), r[0], r[1]), pointSegmentDistance(new Vector3().lerpVectors(r[0], r[1], k), l[0], l[1])]));
  if (gap < LIMIT.across * p.scale) dev.append(time, { check: 'driven legs crossed (m)', value: LIMIT.across * p.scale - gap, limit: 0, where: 'legs' });
  // Noted only: a driven body follows its input, not its balance.
  const support = legs.flatMap((leg) => leg.swing ? [] : solePoints(h, f.prev, leg.side).map((at): [number, number] => [at.x, at.z]));
  if (!support.length) return;
  const com = f.prev.com(new Vector3()), velocity = com.clone().sub(f.prev2.com(new Vector3())).divideScalar(f.dt);
  const xcom = com.addScaledVector(velocity, Math.sqrt(p.legLength / GRAVITY));
  const value = outside(hullOf(support), xcom);
  if (value > LIMIT.xcom) dev.note(time, { check: 'driven XCoM outside support (m)', value, limit: LIMIT.xcom, where: 'hips' });
}

const IDENTITY = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _hip = new Vector3();
const _hipAt = new Vector3();
const _accel = new Vector3();
const _l = new Vector3();
const _f = new Vector3();
const _m = new Vector3();
const _pole = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const _bend = new Quaternion();
const _local = new Quaternion();
const _toes = new Quaternion();
