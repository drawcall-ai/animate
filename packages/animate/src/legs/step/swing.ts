// A foot in the air: where it lands, how it is aimed there and how it swings.
import { Quaternion, Vector3 } from 'three';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, minimumJerk, smoothstep, softplus, wrapAngle, yawOf } from '../../kernel/math';
import { hullOf, outside } from '../support';
import { AIMED, PASSING, SETTLE, SHUFFLING, _a, _b, _c, _f, _hipAt, _hipThen, _l, _m, _n, _o, _v, _w, _x, beyond, remaining, type FootPose, type Leg, type Now, type Steps, type Swing } from './state';
import { hipOf, homeOf, pace, shankLean, travelOf, widthAt, xcomAhead } from './reach';

/** the minimum-jerk quintic from `x` (`v`, `a`) to `x1` at rate `v1` and zero acceleration in `T` s, `t` s on: its value, rate and acceleration (at or past its end: its end) */
export function quintic(x: number, v: number, a: number, x1: number, v1: number, T: number, t: number): [number, number, number] {
  if (T <= t) return [x1, v1, 0];
  const d = x1 - x;
  const c = [
    x, v, a / 2,
    (20 * d - (12 * v + 8 * v1) * T - 3 * a * T * T) / (2 * T ** 3),
    (-30 * d + (16 * v + 14 * v1) * T + 3 * a * T * T) / (2 * T ** 4),
    (12 * d - (6 * v + 6 * v1) * T - a * T * T) / (2 * T ** 5),
  ];
  return [
    c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5])))),
    c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5]))),
    2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5])),
  ];
}

/** Where a foot lands `remaining` s on, the way it faces then, and how far across the other foot it would have landed (m). */
export function landing(steps: Steps, now: Now, leg: Leg, remaining: number): [Vector3, number, number] {
  const { st, feet, legs, pair, yaws } = steps, toeOut = st.toeOut, { r, v, lead, wanted, spin, Ts, sitting } = now;
  // turned toward the root's facing, as far as the other foot lets the pelvis
  const other = legs[pair[leg.i]];
  const body = other.yaw - other.sign * toeOut;
  // (where the root will be and face as it lands, foreseen: as it says, or running on as it turns)
  // (a gait's foot lands as the root goes now, not as its forecast hopes: the legs of a long body hold it back more than a person's)
  const forecast = steps.clocked ? undefined : r.forecast, then = forecast?.(remaining + lead);
  const ahead = then ? wanted + wrapAngle(then.yaw - wanted) : wanted + spin * (remaining + lead);
  // (a gait's foot lands under its hip for the body turned as it is turning now, on to the middle of its stance: one ahead of or
  // behind the root swings out with the turn, from one side of where it stands to the other)
  // (the foot itself heading the body's way as it lands: it pivots on the floor as the body comes round over it)
  const reached = body + clamp(wrapAngle(ahead - body), -steps.pelvisTurn, steps.pelvisTurn);
  const turned = steps.clocked ? yaws[1] + spin * (remaining + Ts / 2) : other.swing ? ahead : reached;
  const footing = steps.clocked ? yaws[1] + spin * remaining : turned;
  const side = leftOf(turned, new Vector3());
  // (as wide as the speed it will land at: a stopping step lands in the standing stance)
  const landed = pace(steps, now, remaining, _w), speed = landed.dot(r.velocity) > 0 ? Math.hypot(landed.x, landed.z) : 0;
  // (along the way it will go, round its curve, but as far as it goes now: a stop is caught by a foot further on — ahead only: one
  // stopping a step aside or back lands where the body stops, beside it)
  const chord = then ? _c.subVectors(then.position, r.position).setY(0) : null, far = Math.max(chord?.length() ?? 0, v * (remaining + lead));
  const on = chord && chord.lengthSq() > 1e-12 ? _n.copy(chord).multiplyScalar(far / chord.length() - 1) : null;
  const forward = forwardOf(turned, _f);
  const to = chord && on
    ? new Vector3().copy(r.position).add(chord).addScaledVector(forward, Math.max(0, on.dot(forward)))
    : new Vector3().copy(r.position).addScaledVector(r.velocity, remaining + lead);
  to.addScaledVector(side, leg.sign * widthAt(steps, now, speed)).addScaledVector(forward, sitting + homeOf(steps, leg)).setY(feet.ankleHeight);
  if (forecast && then) bend(steps, forecast, remaining + lead, then.position, to);
  steady(steps, now, leg, remaining, to, turned, side, speed);
  return [to, footing + leg.sign * toeOut, uncross(steps, now, leg, to, side)];
}

/**
 * A landing `to` foreseen `t` s on at `at` moved out round the bend the body leans into there: the feet land out from its way as far as
 * the extrapolated centre of mass runs out from it — its speed × turn rate (the sideways acceleration) × l/g, halved: Hof's √(l/g) ahead
 * along the tangent, off the arc by its square over twice the radius.
 */
export function bend(steps: Steps, forecast: (ahead: number) => { position: Vector3 }, t: number, at: Vector3, to: Vector3) {
  const before = forecast(Math.max(0, t - BEND_SPAN)).position, after = forecast(t + BEND_SPAN).position;
  const turn = wrapAngle(Math.atan2(after.x - at.x, after.z - at.z) - Math.atan2(at.x - before.x, at.z - before.z));
  const speed = after.distanceTo(before) / (2 * BEND_SPAN);
  to.addScaledVector(leftOf(Math.atan2(after.x - before.x, after.z - before.z), _n), -(speed ** 2) * turn / BEND_SPAN * steps.feet.length / GRAVITY / 2);
}

/**
 * A landing `to` kept in balance: a step whose landing would leave the extrapolated centre of mass as it will be past the feet lands under
 * it instead, just to its side; and no further from it as it is now than the other foot and it hold it: a first step is a short one.
 */
function steady(steps: Steps, now: Now, leg: Leg, remaining: number, to: Vector3, turned: number, side: Vector3, speed: number) {
  const { st, feet, legs, pair } = steps, s = st.scale, { r, airborne } = now, capture = st.capture;
  if (capture === undefined || airborne) return;
  const other = legs[pair[leg.i]];
  const yawed = turned + leg.sign * st.toeOut, others = other.swing ? [] : feet.print(other.i, other.anchor, other.yaw);
  const past = (at: Vector3, centre: Vector3) => outside(hullOf([...feet.print(leg.i, at, yawed), ...others]), centre) > capture * s;
  const centre = xcomAhead(steps, now, remaining, new Vector3());
  const under = (c: Vector3) => c.clone().addScaledVector(side, leg.sign * st.width.narrowest * s / 2).setY(feet.ankleHeight);
  const present = r.xcom;
  // (a walker's slow step lands no further aside of the other foot than `WIDE.stances`, its extrapolated centre of mass, as it will be
  // and is, kept within `WIDE.within` of the feet: it shuffles rather than straddles)
  const gap = _v.subVectors(to, other.anchor).dot(side) * leg.sign, most = WIDE.stances * 2 * st.width.stand;
  if (r.forecast && !other.swing && speed < SHUFFLING * s && gap > most) {
    const narrower = to.clone().addScaledVector(side, -leg.sign * (gap - most));
    const within = (c: Vector3) => outside(hullOf([...feet.print(leg.i, narrower, yawed), ...others]), c) <= WIDE.within * s;
    if (within(centre) && (!present || within(present))) to.copy(narrower);
  }
  if (past(to, centre)) to.copy(under(centre));
  if (!present || other.swing || !past(to, present)) return;
  const from = to.clone(), toward = under(present);
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 12; k++) [lo, hi] = past(_n.lerpVectors(from, toward, (lo + hi) / 2), present) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  to.lerpVectors(from, toward, hi);
}

/** `to` moved onto its own side of the other foot, as the body will face (`side`, its left) and as it faces now; how far it was across (m) */
function uncross(steps: Steps, now: Now, leg: Leg, to: Vector3, side: Vector3): number {
  const { st, legs, pair } = steps, s = st.scale, other = legs[pair[leg.i]];
  let across = 0;
  for (const axis of [side, leftOf(now.yaw, _m)]) {
    // (with a foreseen root, a foot landing a foot's length or more ahead of or behind the other need not land a full stance beside it:
    // the shanks pass apart — but never across the line between them: `PASSING` of the stance kept)
    const along = Math.abs(_v.subVectors(to, other.anchor).dot(_n.set(-axis.z, 0, axis.x)));
    const apart = now.r.forecast ? lerp(PASSING, 1, 1 - smoothstep(SPAN * s, 2 * SPAN * s, along)) : 1;
    const gap = _v.dot(axis) * leg.sign, narrowest = st.width.narrowest * s * apart;
    if (gap < narrowest) to.addScaledVector(axis, leg.sign * (narrowest - gap));
    across = Math.max(across, narrowest - gap);
  }
  return across;
}

/** A landing kept within reach of the hip as it will be (a hard stop pulls it in), heel first only ahead of it. */
export function settle(steps: Steps, now: Now, leg: Leg, w: Swing, aiming = true) {
  const { st, feet } = steps, s = st.scale, { r, yaw, spin, run, holding, reaches } = now, build = feet.legs[leg.i];
  const rest = remaining(w), through = travelOf(steps, now, rest, _v).add(steps.hips);
  const hipAt = (facing: number, root: Vector3, out: Vector3) =>
    out.copy(root).addScaledVector(leftOf(facing, _l), leg.sign * (build.hip ?? feet.hip)).addScaledVector(forwardOf(facing, _o), build.ahead ?? 0);
  const at = hipAt(yaw, through, _hipThen), out = _b.subVectors(leg.anchor, at).setY(0);
  const depth = build.depth;
  if (depth) {
    // (a leg whose joints reach less than a sphere's: its landing pulled in as far as they hold the hip at its height — a gait's hip
    // anywhere between where the body is and faces now and where it is foreseen to as the foot lands: a long body's hips swing
    // round off its turning centre, and its root, all but standing, goes on only as far as its legs keep up)
    const need = holding + (build.up ?? 0) - feet.ankleHeight;
    const then = r.forecast ? r.forecast(rest).yaw : yaw + spin * rest;
    const here = _w.copy(r.position).add(steps.hips);
    const from = (facing: number, root: Vector3, k: number) => {
      const d = _x.copy(at).addScaledVector(out, k).sub(hipAt(facing, root, _c));
      return depth(d.dot(leftOf(facing, _l)) * leg.sign, d.dot(forwardOf(facing, _f))) >= need;
    };
    // (where the root is now only for a body all but standing: one on its way is where it goes)
    const still = here.distanceTo(through) < SETTLED_ROOT * s;
    const turning = (k: number) => from(then, through, k) && (!still || (from(yaw, here, k) && from(then, here, k)));
    const holds = (k: number) => from(yaw, through, k) && (!steps.clocked || turning(k));
    if (!holds(1)) {
      let [lo, hi] = [0, 1];
      for (let n = 0; n < 12; n++) [lo, hi] = holds((lo + hi) / 2) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
      // (its landing within reach before it is clear of the other foot: a gait's feet may pass close, not out of reach)
      leg.anchor.copy(at).addScaledVector(out, lo).setY(feet.ankleHeight);
    }
  } else if (out.length() > reaches[leg.i]) {
    const within = leg.anchor.copy(at).add(out.setLength(reaches[leg.i])).setY(feet.ankleHeight);
    uncross(steps, now, leg, within, leftOf(leg.yaw - leg.sign * st.toeOut, _l));
  }
  // (a walker's — a foreseen root's — foot landing just behind its hip, squaring up, lands flat: toes first only stepping back)
  const ahead = out.dot(forwardOf(leg.yaw)), aim = r.forecast && ahead < 0 ? Math.min(0, ahead + BACKSTEP * s) : ahead;
  if (!aiming) return;
  w.strike = lerp(st.strike.walk, st.strike.run, run) * clamp(aim / (st.strike.ahead * s), -1, 1);
  // (re-aimed to the gait as it goes now — a run eased to a walk — it swings as that gait's: no higher, its arc's peak no later)
  if (w.run > run) [w.lift, w.run] = [w.lift * lerp(st.lift.walk, st.lift.run, run) / lerp(st.lift.walk, st.lift.run, w.run), run];
}

/** A swing moved on a sub-step: re-aimed while it may be, landed once through. */
export function swingOn(steps: Steps, now: Now, leg: Leg, w: Swing) {
  const { st, feet, legs } = steps, s = st.scale, { r, dt, airborne, air, Tsw } = now;
  // (its pace kept to the gait's as the speed changes: quicker at once, slower gradually; in the air, landing as the body does)
  if (airborne) [w.rest, w.T] = [air + dt, (air + dt) / (1 - w.u)];
  else w.T = Math.min(Tsw, w.T + PACE * dt);
  w.rest = (1 - w.u) * w.T;
  w.u = Math.min(1, w.u + dt / w.T);
  w.age += dt;
  // (a walker's — a foreseen root's — landing moves no more once `AIMED` of the swing is gone: moved late, it reads as a stumble;
  // before, one that would leave the extrapolated centre of mass past the feet catches it instead)
  const settling = r.forecast ? AIMED : SETTLE, capture = st.capture;
  if (!w.capture && !airborne && capture !== undefined && w.u < settling) {
    const support = hullOf(legs.flatMap((other) => other === leg || !other.swing ? feet.print(other.i, other.anchor, other.yaw) : []));
    w.capture = outside(support, xcomAhead(steps, now, remaining(w), _c)) > capture * s;
  }
  // (re-aimed through the first half of the swing in time, frozen after: but for a hard stop, pulling it back into reach till late; a catch
  // as long as it may still move)
  const aiming = w.age < remaining(w);
  if (airborne || (w.u < settling && (aiming || w.capture))) [leg.anchor, leg.yaw] = landing(steps, now, leg, remaining(w));
  if (w.u < settling && !airborne) settle(steps, now, leg, w, aiming);
  if (w.u >= 1 - 1e-9) [leg.swing, leg.planted, leg.landed, leg.strike, leg.leapt] = [null, 0, true, w.strike, !!w.rel];
}

/** A foot lifted: its swing set off from where it is, moving as it does, toward its landing. */
export function liftLeg(steps: Steps, now: Now, leg: Leg, capture: boolean) {
  const { st, feet } = steps, s = st.scale, { f, dt, airborne, air, Tsw, run, crouch: k } = now;
  const { foot: bone, toes: toesBone } = feet.legs[leg.i];
  const x = f.prev.position(bone).clone(), velocity = x.clone().sub(f.prev2.position(bone)).divideScalar(dt);
  const toes = toesBone === undefined ? new Quaternion() : f.prev.local(toesBone).clone();
  const T = airborne ? air + dt : Tsw;
  steps.owed[leg.i] = false;
  const turn = { x: leg.yaw, v: wrapAngle(yawOf(f.prev.rotation(bone)) - yawOf(f.prev2.rotation(bone))) / dt, a: 0 };
  const lift = (airborne ? st.lift.jump : lerp(st.lift.walk, st.lift.run, run) * (1 - st.crouch.lift * k)) * s;
  leg.swing = { capture, u: dt / T, age: dt, rest: T, T, x, v: velocity, a: new Vector3(), turn, fromPitch: leg.pitch, toes, strike: 0, lift, run, rel: null };
  [leg.anchor, leg.yaw] = landing(steps, now, leg, T - dt);
  settle(steps, now, leg, leg.swing);
  steps.phase = 2 * Math.PI * st.offsets[leg.i];
  leg.lifted = 0;
}

/** A swing taken to the air mid-step: the step starts over as the leap's, from where the foot is, moving as it does. */
function relaunch(steps: Steps, { f, dt }: Now, leg: Leg, w: Swing) {
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
export function swingPose(steps: Steps, now: Now, leg: Leg, w: Swing, flying: number): FootPose {
  const { st, feet } = steps, s = st.scale, pelvis = steps.pelvis, { f, r, dt, airborne, air, rise, vy, moving } = now;
  const { top } = feet.legs[leg.i];
  if (airborne && !w.rel) relaunch(steps, now, leg, w);
  const u = w.u;
  // (landing as it will stand: heel up already where the shank will lean past the ankle's bend, the hips as low as they are going)
  const topY = f.prev.position(top).y, falling = Math.min(0, topY - f.prev2.position(top).y) / dt;
  const hipLands = _hipAt.copy(hipOf(steps, now, leg)).addScaledVector(r.velocity, w.rest).setY(topY + falling * w.rest);
  const leans = shankLean(steps, hipLands, feet.ankle(leg.i, leg.anchor, leg.yaw, w.strike, _a), leg.yaw);
  const strike = w.strike - beyond(leans + w.strike - st.dorsiflexion) * minimumJerk((u - 0.5) / 0.5);
  const land = feet.ankle(leg.i, leg.anchor, leg.yaw, strike, new Vector3());
  if (airborne) for (const axis of ['x', 'z'] as const) {
    const goal = land[axis] - pelvis[axis] - r.velocity[axis] * air;
    [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], goal, -r.velocity[axis], w.rest, dt);
  }
  else for (const axis of ['x', 'y', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = quintic(w.x[axis], w.v[axis], w.a[axis], land[axis], 0, w.rest, dt);
  // Retarget the turn with its current velocity and acceleration, just like the ankle's position.
  [w.turn.x, w.turn.v, w.turn.a] = quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, w.rest, dt);
  const yawNow = w.turn.x;
  leg.pitch = w.fromPitch * (1 - minimumJerk(u / 0.45)) + strike * minimumJerk((u - 0.6) / 0.4);
  const lean = feet.lean(leg.i, f.prev, yawNow);
  // (walking, pushed off: the ankle plantarflexed most just after the toes leave the floor, in line again by mid-swing)
  if (st.push && !airborne) {
    const pushed = moving * Math.sin(Math.PI * Math.min(1, u / PUSHED)) ** 2;
    leg.pitch = Math.min(leg.pitch, lerp(leg.pitch, Math.max(st.pitch.ball, -st.push - lean), pushed));
  }
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

/** Tuned: a root foreseen to move less than this (m) by a landing is all but standing */
const SETTLED_ROOT = 0.05;
/** Tuned: a walker's foot closing beside the other needs no gap from it once `SPAN` (m) or more ahead or behind */
const SPAN = 0.25;
/** Tuned: a walker's foot lands flat but `BACKSTEP` (m) or more behind its hip */
const BACKSTEP = 0.1;
/** Tuned: a swing's duration grows with the gait's at most `PACE` (s/s) */
const PACE = 1;
/** Tuned: landing a leap, the foot comes down at `TOUCH` of the body's fall */
const TOUCH = 0.85;
/** Recalled (Perry 1992): the push-off peaks just after toe-off, gone by mid-swing; tuned: it eases in and out over the first `PUSHED` of a swing */
const PUSHED = 0.5;
/** a bend a foot lands on is read off the root's forecast `BEND_SPAN` s either side of its landing */
const BEND_SPAN = 0.1;
/** Tuned: a walker's slow step lands at most `WIDE.stances` standing stances aside of the other
 * foot, as balance lets it (1.1: within the metrics' 0.15 H for a straight stop), its extrapolated centre of mass kept within `within` (m) */
const WIDE = { stances: 1.1, within: 0.03 };
const IDENTITY = new Quaternion(), _q = new Quaternion(), _toes = new Quaternion();
