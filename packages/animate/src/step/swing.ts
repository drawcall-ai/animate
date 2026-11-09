// A foot in the air: where it lands, how it is aimed there and how it swings.
import { MathUtils, Quaternion, Vector3 } from 'three';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, quintic, softplus, wrapAngle, yawOf } from '../kernel/math';
import { hullOf, outside } from './support';
import { AIMED, SETTLE, THRESHOLDS, type Steps } from './steps';
import { foldLength, hipOf, home, lengthOf, shankLean, staysOn, travelOf, xcomAhead, overbend } from './leg-reach';
import { foothold, LEVEL } from './floor';
import { arcOf, stepping, swingOver, remaining } from './swing-path';
import type { FootPose, Leg, StepInput, Swing } from './types';
import { uncross, keptTo, inRange, landing } from './landing';

/** A landing kept within reach of the hip as it will be (a hard stop pulls it in), heel first only ahead of it. */
export function settle(steps: Steps, input: StepInput, leg: Leg, w: Swing, aiming = true) {
  const { st, feet } = steps, s = st.scale, { r, yaw, spin, run, holding, reaches } = input, build = feet.legs[leg.i];
  const { onto, stays } = keptTo(input, w);
  const rest = remaining(w), through = travelOf(input, rest, _v).add(steps.hips);
  const hipAt = (facing: number, root: Vector3, out: Vector3) =>
    out.copy(root).addScaledVector(leftOf(facing, _l), leg.sign * (build.hip ?? feet.hip)).addScaledVector(forwardOf(facing, _o), build.ahead ?? 0);
  // The capsule may stop below a future tread. Landings must fit the legs while standing on its actual support.
  if (input.contact && !inRange(steps, input, leg, input.contact, leg.anchor.y)) {
    supportFoot(steps, input, leg, input.contact);
    w.onto = leg.anchor.y - feet.ankleHeight;
    w.strike = 0;
    return;
  }
  const at = hipAt(yaw, through, _hipThen), out = _b.subVectors(leg.anchor, at).setY(0);
  const depth = build.depth;
  if (depth) {
    // (a leg whose joints reach less than a sphere's: its landing pulled in as far as they hold the hip at its height — a gait's hip
    // anywhere between where the body is and faces now and where it is foreseen to as the foot lands: a long body's hips swing
    // round off its turning centre, and its root, all but standing, goes on only as far as its legs keep up)
    const need = holding + (build.up ?? 0) - leg.anchor.y;
    const then = r.forecast ? r.forecast(rest).yaw : yaw + spin * rest;
    const here = _w.copy(r.position).add(steps.hips);
    const from = (facing: number, root: Vector3, k: number) => {
      const d = _x.copy(at).addScaledVector(out, k).sub(hipAt(facing, root, _c));
      return depth(d.dot(leftOf(facing, _l)) * leg.sign, d.dot(forwardOf(facing, _f))) >= need;
    };
    // (where the root is now only for a body all but standing: one on its way is where it goes)
    const still = here.distanceTo(through) < SETTLED_ROOT * s;
    const turning = (k: number) => from(then, through, k) && (!still || (from(yaw, here, k) && from(then, here, k)));
    const holds = (k: number) => from(yaw, through, k) && (!steps.clock || turning(k));
    if (!holds(1)) {
      let [lo, hi] = [0, 1];
      for (let n = 0; n < 12; n++) [lo, hi] = holds((lo + hi) / 2) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
      // (its landing within reach before it is clear of the other foot: a gait's feet may pass close, not out of reach)
      foothold(steps.floor, feet, leg.i, leg.anchor.copy(at).addScaledVector(out, lo), leg.yaw, undefined, onto, stays);
    }
  } else {
    // A committed landing above the current floor has more horizontal reach than a same-level one.
    const vertical = holding + input.climb * rest + (build.up ?? 0) - leg.anchor.y;
    const reach = input.contact && !aiming ? Math.max(reaches[leg.i], Math.sqrt(Math.max(0, (st.reach * lengthOf(steps, leg)) ** 2 - vertical ** 2))) : reaches[leg.i];
    if (out.length() > reach) {
      const within = leg.anchor.copy(at).add(out.setLength(reach));
      uncross(steps, input, leg, within, leftOf(leg.yaw - leg.sign * st.toeOut, _l));
      foothold(steps.floor, feet, leg.i, within, leg.yaw, undefined, onto, stays);
    }
  }
  // (a walker's — a foreseen root's — foot landing just behind its hip, squaring up, lands flat: toes first only stepping back)
  const ahead = out.dot(forwardOf(leg.yaw)), aim = r.forecast && ahead < 0 ? Math.min(0, ahead + BACKSTEP * s) : ahead;
  if (!aiming) return;
  // (stepping down onto a lower tread, toes first, the heel kept up over the edge it leaves; up onto a higher one, flat — recalled: stair
  // descent lands on the forefoot, ascent on the forefoot or the whole foot)
  const strike = lerp(st.strike.walk, st.strike.run, run), { up, down } = stepping(steps, leg, w);
  w.strike = lerp(lerp(strike * clamp(aim / (st.strike.ahead * s), -1, 1), -strike, down), 0, up);
  // (re-aimed to the gait as it goes now — a run eased to a walk — it swings as that gait's: no higher, its arc's peak no later)
  if (w.run > run) [w.lift, w.run] = [w.lift * lerp(st.lift.walk, st.lift.run, run) / lerp(st.lift.walk, st.lift.run, w.run), run];
}

/** A swing moved on a sub-step: re-aimed while it may be, landed once through. */
export function swingOn(steps: Steps, input: StepInput, leg: Leg, w: Swing) {
  const { st, feet, legs } = steps, s = st.scale, { r, dt, airborne, air, Tsw } = input;
  // (its pace kept to the gait's as the speed changes: quicker at once, slower gradually; in the air, landing as the body does)
  if (airborne) [w.rest, w.T] = [air + dt, (air + dt) / (1 - w.u)];
  else if (!leg.leapt) w.T = Math.min(Tsw, w.T + PACE * dt);
  w.rest = (1 - w.u) * w.T;
  w.u = Math.min(1, w.u + dt / w.T);
  w.age += dt;
  // (physics decides contact; an unsupported foot cannot plant just because its planned swing ran out)
  if (input.flight) w.u = Math.min(w.u, AFLOAT);
  if (input.contact && w.rel) touchdown(steps, input, leg, w, w.rel, input.contact);
  // (a walker's — a foreseen root's — landing moves no more once `AIMED` of the swing is gone: moved late, it reads as a stumble;
  // before, one that would leave the extrapolated centre of mass past the feet catches it instead)
  const settling = r.forecast ? AIMED : SETTLE, capture = st.capture;
  if (!leg.leapt && !w.capture && !airborne && capture !== undefined && w.u < settling) {
    const support = hullOf(legs.flatMap((other) => other === leg || !other.swing ? feet.print(other.i, other.anchor, other.yaw) : []));
    w.capture = outside(support, xcomAhead(steps, input, remaining(w), _c)) > capture * s;
  }
  // (re-aimed through the first half of the swing in time, frozen after: but for a hard stop, pulling it back into reach till late; a catch
  // as long as it may still move)
  // (and through a quick turn the other foot pivots under: a step under way as one began landed behind it, the pelvis held back for it)
  const aiming = w.age < remaining(w) || (input.spinning && steps.pivots(legs[steps.pair[leg.i]]));
  if (airborne || (!leg.leapt && w.u < settling && (aiming || w.capture))) [leg.anchor, leg.yaw] = landing(steps, input, leg, airborne ? air : remaining(w));
  if (!leg.leapt && w.u < settling && !airborne) settle(steps, input, leg, w, aiming);
  // (landed at the pitch it was last posed coming down at — its strike, the heel let down as far as the shank leans past the ankle's bend
  // — the planted foot rolls on from there: from the strike as planned, a foot rising out of a crouch toes first came down 3 mm onto its heel
  // in the frame it landed)
  if (w.u >= 1 - 1e-9) [leg.swing, leg.planted, leg.landed, leg.strike, leg.leapt] = [null, 0, true, leg.pitch, leg.leapt || !!w.rel];
}

/** Finish a physical landing from the current pose, rather than snapping a tucked foot onto its contact. */
function touchdown(steps: Steps, input: StepInput, leg: Leg, w: Swing, rel: NonNullable<Swing['rel']>, contact: Vector3) {
  const { st, feet } = steps, { f, dt, Tsw } = input;
  const { foot, toes } = feet.legs[leg.i];
  // Touchdown stays on the current support; the next stride's lead may already be beyond a small platform.
  leg.yaw = input.yaw + leg.sign * st.toeOut;
  home(steps, input, leg, input.landAhead, leg.anchor);
  foothold(steps.floor, feet, leg.i, leg.anchor, leg.yaw, undefined, contact.y, true);
  if (Math.abs(leg.anchor.y - feet.ankleHeight - contact.y) > LEVEL) supportFoot(steps, input, leg, contact);
  // The controller's contact ends the fall, not the foot's path. Continue from its last
  // pose in world space so a still tucked leg extends into contact instead of teleporting.
  w.x.copy(f.prev.position(foot));
  w.v.copy(w.x).sub(f.prev2.position(foot)).divideScalar(dt);
  w.a.y = -rel.a - GRAVITY;
  w.rel = null;
  const to = feet.ankle(leg.i, leg.anchor, leg.yaw, 0, _a).sub(w.x), distance = to.length();
  const closing = distance > 0 ? w.v.dot(to) / distance : 0;
  const time = Math.max(dt, closing > 0 ? Math.min(Tsw, 2 * distance / closing) : Tsw);
  [w.u, w.age, w.rest, w.T, w.lift, w.fromPitch] = [dt / time, dt, time, time, 0, leg.pitch];
  [w.level, w.onto, w.stays, w.strike, w.lowering] = [steps.floor(w.x.x, w.x.z), contact.y, true, 0, NaN];
  if (toes !== undefined) w.toes.copy(f.prev.local(toes));
  leg.leapt = true;
}

/** Fit a foot beside the controller's actual contact, including support beyond its centre at an edge. */
function supportFoot(steps: Steps, input: StepInput, leg: Leg, contact: Vector3) {
  home(steps, input, leg, 0, leg.anchor).add(contact).sub(input.r.position);
  foothold(steps.floor, steps.feet, leg.i, leg.anchor, leg.yaw, undefined, contact.y, true);
}

/** A foot lifted: its swing set off from where it is, moving as it does, toward its landing. */
export function liftLeg(steps: Steps, input: StepInput, leg: Leg, { capture, unloaded }: Pick<Swing, 'capture' | 'unloaded'>) {
  const { st, feet } = steps, s = st.scale, { f, dt, airborne, air, Tsw, run, crouch: k } = input;
  const { foot: bone, toes: toesBone } = feet.legs[leg.i];
  const x = f.prev.position(bone).clone(), velocity = x.clone().sub(f.prev2.position(bone)).divideScalar(dt);
  const toes = toesBone === undefined ? new Quaternion() : f.prev.local(toesBone).clone();
  const T = airborne ? air + dt : Tsw;
  const turn = { x: leg.yaw, v: wrapAngle(yawOf(f.prev.rotation(bone)) - yawOf(f.prev2.rotation(bone))) / dt, a: 0 };
  const lift = (airborne ? st.lift.jump : lerp(st.lift.walk, st.lift.run, run) * (1 - st.crouch.lift * k)) * s;
  const level = leg.anchor.y - feet.ankleHeight;
  const swing: Swing = { capture, unloaded, stays: !airborne && staysOn(steps, input, level, T - dt), u: dt / T, age: dt, rest: T, T, level, drop: feet.ankleHeight, x, v: velocity, a: new Vector3(), turn, fromPitch: leg.pitch, toes, strike: 0, lift, run, rel: null, lowering: NaN, onto: NaN };
  const next: Leg = { ...leg, anchor: leg.anchor.clone(), swing };
  [next.anchor, next.yaw] = landing(steps, input, next, T - dt);
  swing.onto = next.anchor.y - feet.ankleHeight;
  settle(steps, input, next, swing);
  // A stationary stance can be out of reach on a narrow support; repeating its feasible contact cannot improve it.
  if (input.contact && !airborne && input.v === 0 && next.anchor.distanceTo(leg.anchor) < THRESHOLDS.still * s
    && Math.abs(wrapAngle(next.yaw - leg.yaw)) < THRESHOLDS.squared) return;
  [leg.anchor, leg.yaw, leg.swing, leg.leapt] = [next.anchor, next.yaw, swing, false];
  if (steps.clock) steps.clock.owed[leg.i] = false;
  steps.phase = 2 * Math.PI * st.offsets[leg.i];
  leg.lifted = 0;
}

/** A swing taken to the air mid-step: the step starts over as the leap's, from where the foot is, moving as it does. */
function relaunch(steps: Steps, { f, dt }: StepInput, leg: Leg, w: Swing) {
  const { st } = steps, { foot: footBone, toes: toesBone } = steps.feet.legs[leg.i];
  const at = f.prev.position(footBone), was = f.prev2.position(footBone), hips = f.prev.position(0), hipsWas = f.prev2.position(0);
  w.rel = { x: hips.y - at.y, v: (hips.y - at.y - hipsWas.y + was.y) / dt, a: 0 };
  w.x.set(at.x - hips.x, at.y, at.z - hips.z);
  w.v.set(at.x - was.x - hips.x + hipsWas.x, at.y - was.y, at.z - was.z - hips.z + hipsWas.z).divideScalar(dt);
  w.a.set(0, 0, 0);
  [w.fromPitch, w.u, w.T, w.age, w.lift, w.run] = [leg.pitch, dt / w.rest, w.rest, dt, st.lift.jump * st.scale, 0];
  if (toesBone !== undefined) w.toes.copy(f.prev.local(toesBone));
}

/** A swinging foot: minimum jerk toward its landing (heel strike), the lift arc over it, clear of the floor. */
export function swingPose(steps: Steps, input: StepInput, leg: Leg, w: Swing, flying: number): FootPose {
  const { st, feet } = steps, s = st.scale, pelvis = steps.pelvis, { f, r, dt, airborne, air, rise, vy, moving } = input;
  const { top } = feet.legs[leg.i];
  if (airborne && !w.rel) relaunch(steps, input, leg, w);
  const u = w.u;
  // (the highest its ankle may be where it is now: below its hip by the leg folded as far as it goes)
  const ceiling = () => {
    const hip = hipOf(steps, input, leg), d = Math.hypot(w.x.x - hip.x, w.x.z - hip.z);
    return flying + rise + (feet.legs[leg.i].up ?? 0) - Math.sqrt(Math.max(0, foldLength(steps) ** 2 - d * d));
  };
  // (landing as it will stand: heel up already where the shank will lean past the ankle's bend, the hips as low as they are going)
  const topY = f.prev.position(top).y, falling = Math.min(0, topY - f.prev2.position(top).y) / dt;
  const hipLands = _hipAt.copy(hipOf(steps, input, leg)).addScaledVector(r.velocity, w.rest).setY(topY + falling * w.rest);
  const leans = shankLean(steps, hipLands, feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _a), leg.yaw);
  const strike = w.strike - overbend(leans + w.strike - st.dorsiflexion) * minimumJerk((u - 0.5) / 0.5);
  const land = feet.ankle(leg.i, leg.anchor, leg.yaw, strike, new Vector3());
  if (airborne) for (const axis of ['x', 'z'] as const) {
    const rising = input.flight && vy > 0;
    const goal = land[axis] - pelvis[axis] - r.velocity[axis] * (air + (rising ? input.landAhead : 0));
    [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], goal, rising ? 0 : -r.velocity[axis], w.rest, dt);
  }
  else swingOver(steps, input, leg, w, land, ceiling(), dt);
  // Retarget the turn with its current velocity and acceleration, just like the ankle's position.
  [w.turn.x, w.turn.v, w.turn.a] = quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, w.rest, dt);
  const yawNow = w.turn.x;
  leg.pitch = w.fromPitch * (1 - minimumJerk(u / 0.45)) + strike * minimumJerk((u - 0.6) / 0.4);
  const lean = feet.lean(leg.i, f.prev, yawNow);
  // (walking, pushed off: the ankle plantarflexed most just after the toes leave the floor, in line again by mid-swing)
  if (st.push && !airborne && !leg.leapt) {
    const pushed = moving * Math.sin(Math.PI * Math.min(1, u / PUSHED)) ** 2;
    leg.pitch = Math.min(leg.pitch, lerp(leg.pitch, Math.max(st.pitch.ball, -st.push - lean), pushed));
  }
  // (its own shank's lean bends the ankle early in the swing; landing, the strike already stands as it will)
  leg.pitch -= overbend(lean + leg.pitch - st.dorsiflexion) * (1 - minimumJerk((u - 0.6) / 0.4));
  if (st.plantarflexion !== undefined) leg.pitch = Math.max(leg.pitch, -st.plantarflexion - lean);
  const foot = feet.rotation(yawNow, leg.pitch, new Quaternion());
  // (the toes relax off the floor into line, and landing toes first come down flat)
  const toes = foot.clone().multiply(_q.copy(w.toes).slerp(IDENTITY, minimumJerk(u / 0.3)))
    .slerp(feet.rotation(yawNow, Math.max(0, leg.pitch), _toes), minimumJerk((u - 0.6) / 0.4));
  const room = Math.max(0, ceiling() - w.x.y);
  // The decorative arc must fit below the hip even when the terrain path already rises steeply.
  const arc = airborne ? arcOf(steps, input, leg, w, u) : Math.min(arcOf(steps, input, leg, w, u), room);
  const ankle = w.x.clone().setY(w.x.y + arc);
  if (airborne) {
    // (in the air the leg's length is planned, not the foot's height: hanging from the hips, tucked
    // between; landing, the foot comes down with the body, slowed a little by the knees bending)
    const rel = w.rel;
    if (!rel) throw new Error('a swing in the air without its leap');
    const pelvisY = flying + rise;
    if (input.flight) {
      const tucked = minimumJerk(steps.jumping.since / TUCK.seconds) * (vy < 0 ? MathUtils.smoothstep(input.clearance, TUCK.low * s, TUCK.high * s) : 1);
      const length = steps.stand - feet.ankleHeight - st.crouch.depth * s * input.crouch - st.lift.jump * s * tucked;
      [rel.x, rel.v, rel.a] = quintic(rel.x, rel.v, rel.a, length, 0, input.Tsw, dt);
      ankle.set(pelvis.x + w.x.x, pelvisY - rel.x, pelvis.z + w.x.z);
    } else {
      const falls = rise + vy * air - GRAVITY * air * air / 2;
      [rel.x, rel.v, rel.a] = quintic(rel.x, rel.v, rel.a, flying + falls - land.y, (1 - TOUCH) * (vy - GRAVITY * air), w.rest, dt);
      ankle.set(pelvis.x + w.x.x, pelvisY - rel.x + arc, pelvis.z + w.x.z);
    }
  }
  const soles = feet.soles(leg.i, ankle, foot, toes);
  const drop = Math.min(ankle.y - Math.min(...soles.map((p) => p.y)), feet.ankleHeight + TOES * s);
  w.drop += (drop - w.drop) * Math.min(1, DROPPING * dt);
  const soft = 0.004 * Math.sin(Math.PI * u) ** 2 + Number.EPSILON;
  const sunk = -steps.above(soles);
  const correction = softplus(st.clearance * s * Math.sin(Math.PI * u) ** 3 + sunk, soft);
  ankle.y += correction;
  if (input.contact && !airborne && sunk > 1e-6 * s) {
    // The path shares the actual contact correction, or it falls back through the nosing as the toes clear it.
    w.x.y += sunk;
    w.v.y = Math.max(0, w.v.y);
    w.a.y = Math.max(0, w.a.y);
  }
  return { ankle, foot, toes, yaw: yawNow };
}


/** Tuned: how quickly (1/s) a swing's reckoning of how far its sole hangs below its ankle follows the foot's pitch, and how much lower than
 * standing flat (m, default body) it reckons at most: a foot lifted higher for its toes would bend its knee, pitch its toes down further
 * and be lifted higher again */
const DROPPING = 15, TOES = 0.07;
/** Tuned: a root foreseen to move less than this (m) by a landing is all but standing */
const SETTLED_ROOT = 0.05;
/** Tuned: a walker's foot lands flat but `BACKSTEP` (m) or more behind its hip */
const BACKSTEP = 0.1;
/** Tuned: a swing's duration grows with the gait's at most `PACE` (s/s) */
const PACE = 1;
/** Tuned: in a flight physics owns, a swing goes no further through than this (u) till physics sets the body down */
const AFLOAT = 0.95;
/** Tuned: in a flight physics owns, the feet tuck up over `seconds` from leaving the floor, and let down again falling, between `high`
 * and `low` (m) over the floor */
const TUCK = { seconds: 0.18, low: 0.02, high: 0.4 };
/** Tuned: landing a leap, the foot comes down at `TOUCH` of the body's fall */
const TOUCH = 0.85;
/** Recalled (Perry 1992): the push-off peaks just after toe-off, gone by mid-swing; tuned: it eases in and out over the first `PUSHED` of a swing */
const PUSHED = 0.5;
const IDENTITY = new Quaternion(), _q = new Quaternion(), _toes = new Quaternion();
const [_v, _w, _a, _b, _c, _x, _hipAt, _l, _f, _o, _hipThen] = Array.from({ length: 11 }, () => new Vector3());
