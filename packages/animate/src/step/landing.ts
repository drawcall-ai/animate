// Where a swinging foot lands: under its home at the landing, within what balance, the other foot and the pelvis's turn let it.
import { MathUtils, Vector3 } from 'three';
import { clamp, forwardOf, GRAVITY, leftOf, lerp, wrapAngle } from '../kernel/math';
import { hullOf, outside } from './support';
import { runs, PASSING, PIVOTED, PIVOTING, SHUFFLING, TURN, strayRoom, turnTo } from './thresholds';
import type { Stepper } from './stepper';
import { homeOf, velocityAhead, widthAt, xcomAhead, foldLength, lengthOf } from './leg-reach';
import { FLAT, foothold } from './floor';
import { RISE } from './swing-path';
import type { Leg, StepInput, Swing } from './types';

/** Where a foot lands `remaining` s on, the way it faces then, and how far across the other foot it would have landed (m). */
export function landing(stepper: Stepper, leg: Leg, remaining: number): [Vector3, number, number] {
  const { st, feet, legs, pair, yaws, input } = stepper, toeOut = st.toeOut, { r, v, landAhead, wanted, spin, Ts, sitting } = input;
  // (where the root will be and face as it lands, foreseen: as it says, or running on as it turns)
  // (a gait's foot lands as the root goes now, not as its forecast hopes: the legs of a long body hold it back more than a person's)
  const forecast = stepper.clock ? undefined : r.forecast, then = forecast?.(remaining + landAhead);
  const ahead = then ? wanted + wrapAngle(then.yaw - wanted) : wanted + spin * (remaining + landAhead);
  // turned toward the root's facing, as far past the other foot as the pelvis turns from it: as it stands, or as it will stand by then,
  // pivoting after the pelvis (`Stepper.pivots`) — aimed from where it stood, a quick turn's landing fell behind and the foot stepped again
  const other = legs[pair[leg.i]], body = stepper.pivoting && !other.swing ? pivoted(stepper, other, ahead, remaining) : other.yaw - other.sign * toeOut;
  // (a gait's foot lands under its hip for the body turned as it is turning now, on to the middle of its stance: one ahead of or
  // behind the root swings out with the turn, from one side of where it stands to the other)
  // (the foot itself heading the body's way as it lands: it pivots on the floor as the body comes round over it)
  const reached = body + clamp(turnTo(body, ahead, stepper.way), -stepper.pelvisTurn, stepper.pelvisTurn);
  const turned = stepper.clock ? yaws[1] + spin * (remaining + Ts / 2) : other.swing ? ahead : reached;
  const heading = stepper.clock ? yaws[1] + spin * remaining : turned;
  const side = leftOf(turned, new Vector3());
  // (as wide as the speed it will land at: a stopping step lands in the standing stance)
  const landed = velocityAhead(input, remaining, _w), speed = landed.dot(r.velocity) > 0 ? Math.hypot(landed.x, landed.z) : 0;
  // (along the way it will go, round its curve, but as far as it goes now: a stop is caught by a foot further on — ahead only: one
  // stopping a step aside or back lands where the body stops, beside it. Arriving on a still mark, no further on than the extrapolated
  // centre of mass as it lands, braking where it brakes: carried on at the speed it went, a closing step landed 9–13 cm past the mark and
  // stepped back — Hof's foot placement at the XCoM, recalled: Hof, Gazendam & Sinke 2005, J Biomech 38:1. A goal followed, which may
  // move off any moment, keeps the margin of a foot further on. None on a way back against the root's going: a forecast turning back
  // by a hair as the root overshoots its stop, carried on so, put a closing step 5 cm the other way)
  const chord = then ? _c.subVectors(then.position, r.position).setY(0) : null, along = chord?.length() ?? 0;
  const on = chord && chord.dot(r.velocity) < 0 ? 0 : v * (remaining + landAhead);
  const far = Math.max(along, r.arriving ? Math.min(on, along + speed * Math.sqrt(feet.length / GRAVITY)) : on);
  const past = chord && chord.lengthSq() > 1e-12 ? _n.copy(chord).multiplyScalar(far / chord.length() - 1) : null;
  const forward = forwardOf(turned, _f);
  const to = chord && past
    ? new Vector3().copy(r.position).add(chord).addScaledVector(forward, Math.max(0, past.dot(forward)))
    : new Vector3().copy(r.position).addScaledVector(r.velocity, remaining + landAhead);
  to.addScaledVector(side, leg.sign * widthAt(stepper, input, speed)).addScaledVector(forward, sitting + homeOf(stepper, leg));
  if (forecast && then) bend(stepper, forecast, remaining + landAhead, then.position, to);
  steady(stepper, leg, remaining, to, turned, side, speed);
  const yaw = heading + leg.sign * toeOut, across = uncross(stepper, leg, to, side);
  const w = leg.swing, balance = stepper.floor === FLAT ? undefined : balanced(stepper, leg, remaining, yaw), { contact } = input;
  const keeps = contact
    ? (at: Readonly<Vector3>) => inRange(stepper, leg, contact, stepper.floor(at.x, at.z) + feet.ankleHeight) && (!balance || balance(at))
    : balance;
  const { onto, stays } = keptTo(input, w);
  return [foothold(stepper.floor, feet, leg.i, to, yaw, keeps, onto, stays), yaw, across];
}
/** which way pivoting foot `foot` will head `remaining` s on, its toe-out taken off (rad): the pelvis turned toward `ahead` as fast as it
 * turns and as far as the pivot lets it, the foot within `PIVOTED` of it */
function pivoted(stepper: Stepper, foot: Leg, ahead: number, remaining: number): number {
  const { yaws } = stepper, most = TURN.speed * remaining, from = stepper.pivotFrom(foot, yaws[1]);
  const pelvis = clamp(yaws[1] + clamp(turnTo(yaws[1], ahead, stepper.way), -most, most), from - PIVOTING, from + PIVOTING);
  const input = pelvis + wrapAngle(foot.yaw - foot.sign * stepper.st.toeOut - pelvis);
  return clamp(input, pelvis - PIVOTED, pelvis + PIVOTED);
}
/** whether a landing heading `yaw`, `remaining` s on, keeps the extrapolated centre of mass within `capture` of the feet, as it will be
 * and as it is (none for a body that does not catch its balance) */
function balanced(stepper: Stepper, leg: Leg, remaining: number, yaw: number): ((at: Readonly<Vector3>) => boolean) | undefined {
  const { st, feet, legs, pair, input } = stepper, capture = st.capture, other = legs[pair[leg.i]];
  if (capture === undefined || input.airborne || runs(st, input.v)) return undefined;
  const others = other.swing ? [] : feet.print(other.i, other.anchor, other.yaw), centre = xcomAhead(stepper, remaining, new Vector3());
  const centres = input.r.xcom ? [centre, input.r.xcom] : [centre];
  return (at) => {
    const support = hullOf([...feet.print(leg.i, at, yaw), ...others]);
    return centres.every((c) => outside(support, c) <= capture * st.scale);
  };
}
/**
 * A landing `to` foreseen `t` s on at `at` moved out round the bend the body leans into there: the feet land out from its way as far as
 * the extrapolated centre of mass runs out from it — its speed × turn rate (the sideways acceleration) × l/g, halved: Hof's √(l/g) ahead
 * along the tangent, off the arc by its square over twice the radius.
 */
function bend(stepper: Stepper, forecast: (ahead: number) => { position: Vector3 }, t: number, at: Vector3, to: Vector3) {
  const before = forecast(Math.max(0, t - BEND_SPAN)).position, after = forecast(t + BEND_SPAN).position;
  const turn = wrapAngle(Math.atan2(after.x - at.x, after.z - at.z) - Math.atan2(at.x - before.x, at.z - before.z));
  const speed = after.distanceTo(before) / (2 * BEND_SPAN);
  to.addScaledVector(leftOf(Math.atan2(after.x - before.x, after.z - before.z), _n), -(speed ** 2) * turn / BEND_SPAN * stepper.feet.length / GRAVITY / 2);
}
/**
 * A landing `to` kept in balance: a step whose landing would leave the extrapolated centre of mass as it will be past the feet lands under
 * it instead, just to its side; and no further from it as it is now than the other foot and it hold it: a first step is a short one.
 */
function steady(stepper: Stepper, leg: Leg, remaining: number, to: Vector3, turned: number, side: Vector3, speed: number) {
  const { st, feet, legs, pair, input } = stepper, s = st.scale, { r, airborne } = input, capture = st.capture;
  if (capture === undefined || airborne || runs(st, input.v)) return;
  const other = legs[pair[leg.i]];
  const yawed = turned + leg.sign * st.toeOut, others = other.swing ? [] : feet.print(other.i, other.anchor, other.yaw);
  const past = (at: Vector3, centre: Vector3, margin = capture) => outside(hullOf([...feet.print(leg.i, at, yawed), ...others]), centre) > margin * s;
  // (as it will be: carried toward the landing foot as far as the pelvis sways over it beyond the midline — a wide stride's)
  const centre = xcomAhead(stepper, remaining, new Vector3()).addScaledVector(side, leg.sign * (st.width.sway ?? 0) * s * MathUtils.smoothstep(speed, 0, 1));
  const under = (c: Vector3) => c.clone().addScaledVector(side, leg.sign * st.width.narrowest * s / 2);
  const present = r.xcom;
  // (a walker's slow step lands no further aside of the other foot than `WIDE.stances`, its extrapolated centre of mass, as it will be
  // and is, kept within `WIDE.within` of the feet: it shuffles rather than straddles — but not in under the body past where it would
  // stray from its hip, `WIDE.room` of that to spare: there it would step again at once, to the same place, beside a foot standing wide)
  const gap = _v.subVectors(to, other.anchor).dot(side) * leg.sign, most = WIDE.stances * 2 * st.width.stand;
  if (stepper.foreseen && !other.swing && speed < SHUFFLING * s && gap > most) {
    const room = WIDE.room * strayRoom(st, feet, leg, widthAt(stepper, input, speed));
    const narrower = to.clone().addScaledVector(side, -leg.sign * Math.min(gap - most, room));
    const within = (c: Vector3) => outside(hullOf([...feet.print(leg.i, narrower, yawed), ...others]), c) <= WIDE.within * s;
    if (within(centre) && (!present || within(present))) to.copy(narrower);
  }
  // (a landing that would leave it past the feet goes on as far ahead as it is first, as wide as it lands, if that has it within them; under
  // it, just to its side, only if not: else a stride a little longer than tuned — a person's own, slower cadence — brings the feet into one
  // line)
  if (past(to, centre)) {
    const way = forwardOf(turned, _way), ahead = _ahead.copy(to).addScaledVector(way, Math.max(0, _v.subVectors(centre, to).dot(way)));
    to.copy(past(ahead, centre, 0) ? under(centre) : ahead);
  }
  if (!present || other.swing || !past(to, present)) return;
  const from = to.clone(), toward = under(present);
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 12; k++) [lo, hi] = past(_n.lerpVectors(from, toward, (lo + hi) / 2), present) ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
  to.lerpVectors(from, toward, hi);
}
/** `to` moved onto its own side of the other foot, as the body will face (`side`, its left) and as it faces now; how far it was across (m) */
export function uncross(stepper: Stepper, leg: Leg, to: Vector3, side: Vector3): number {
  const { st, legs, pair } = stepper, s = st.scale, other = legs[pair[leg.i]];
  let across = 0;
  for (const axis of [side, leftOf(stepper.input.yaw, _m)]) {
    // (with a foreseen root, a foot landing a foot's length or more ahead of or behind the other need not land a full stance beside it:
    // the shanks pass apart — but never across the line between them: `PASSING` of the stance kept)
    const along = Math.abs(_v.subVectors(to, other.anchor).dot(_n.set(-axis.z, 0, axis.x)));
    const apart = stepper.foreseen ? lerp(PASSING, 1, 1 - MathUtils.smoothstep(along, SPAN * s, 2 * SPAN * s)) : 1;
    const gap = _v.dot(axis) * leg.sign, narrowest = st.width.narrowest * s * apart;
    if (gap < narrowest) to.addScaledVector(axis, leg.sign * (narrowest - gap));
    across = Math.max(across, narrowest - gap);
  }
  return across;
}
/** Tuned: a walker's foot closing beside the other needs no gap from it once `SPAN` (m) or more ahead or behind */
const SPAN = 0.25;
/** a bend a foot lands on is read off the root's forecast `BEND_SPAN` s either side of its landing */
const BEND_SPAN = 0.1;
/** Tuned: a walker's slow step lands at most `WIDE.stances` standing stances aside of the other
 * foot, as balance lets it (1.1: within the metrics' 0.15 H for a straight stop), its extrapolated centre of mass kept within `within` (m),
 * and in under the body no further than `room` of how far it may before it strays */
const WIDE = { stances: 1.1, within: 0.03, room: 0.5 };
const _ahead = new Vector3(), _way = new Vector3();
const [_v, _w, _c, _n, _f, _m] = Array.from({ length: 6 }, () => new Vector3());

/** the level a swing's landing keeps to: the one it lifts from, stepping where the body stands; else the one it was first aimed onto, if
 * it has been and that is no higher than the floor it left (a swing up a stair kept to its tread jarred the knee 66° in a sub-step at the
 * flight's top: it goes where its landing fits) */
const ontoOf = (w: Swing) => w.stays ? w.level : Number.isNaN(w.onto) || w.onto > w.level + RISE ? undefined : w.onto;
/** the level swing `w`'s landing keeps to and whether it stays on the one it lifts from: physical strides follow the terrain as it is,
 * an in-place refit stays on the support it already has */
export function keptTo(input: StepInput, w: Swing | null): { onto: number | undefined; stays: boolean } {
  const stays = !input.flight && !!w?.stays;
  return { onto: w && (!input.physical || stays) ? ontoOf(w) : undefined, stays };
}
/** Whether an ankle at `ankle` (m high) is within its leg's range from the hip standing on physics' `contact`: no higher than the knee
 * folds to, no lower than the leg reaches. */
export function inRange(stepper: Stepper, leg: Leg, contact: Vector3, ankle: number): boolean {
  const { st, feet, input } = stepper, up = feet.legs[leg.i].up ?? 0, folded = foldLength(stepper);
  const hip = stepper.holding + (contact.y - input.ground) + up, lowest = Math.min(hip, contact.y + feet.ankleHeight + folded + up);
  return hip - ankle >= folded && lowest - ankle <= st.reach * lengthOf(stepper, leg);
}
