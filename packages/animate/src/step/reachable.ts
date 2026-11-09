// Whether the legs would keep up with a root going as a forecast has it: what a planner asks before it goes.
import { Vector3 } from 'three';
import { SUBSTEP } from '../kernel/frame';
import { forwardOf, leftOf, quintic, wrapAngle } from '../kernel/math';
import { AWAIT } from './gait-clock';
import { landing } from './landing';
import { AIMED, runs, SETTLE, strayPast, THRESHOLDS, type Steps } from './steps';
import { hullOf, outside, xcomOf } from './support';
import { settle } from './swing';
import { remaining } from './swing-path';
import type { Leg } from './types';

type Forecast = (ahead: number) => { position: Vector3; yaw: number };

/**
 * Whether the legs keep up with a root that goes as `forecast` has it (its floor point and facing `ahead` s on), as they now stand: each
 * planted foot within its leg's reach — the pelvis let down all it may, the foot rolled as far as it may — until it may next lift (the
 * other foot down), and turned from it no further than the pelvis turns; each swing past re-aiming lands within reach of its hip.
 */
export function reachable(steps: Steps, forecast: Forecast): boolean {
  const { st, feet, legs, pair, clock } = steps;
  if (Number.isNaN(steps.low)) return true;
  // (a person's run, as it will be going by the time its stride is set, is no walk: nothing below holds it. Each stance is cut to its travel,
  // each foot aimed by its forecast, and a flight has no feet to be within: what a player's root runs on, foreseeing nothing)
  if (!clock && runs(st, forecast(PACING + SUBSTEP).position.distanceTo(forecast(PACING).position) / SUBSTEP)) return true;
  const hipAt = (leg: Leg, at: { position: Vector3; yaw: number }) => {
    const build = feet.legs[leg.i];
    return _w.copy(at.position).add(steps.hips).addScaledVector(leftOf(at.yaw, _m), leg.sign * (build.hip ?? feet.hip))
      .addScaledVector(forwardOf(at.yaw, _o), build.ahead ?? 0).setY(0);
  };
  const inwardOf = (leg: Leg, at: { position: Vector3; yaw: number }) => _b.subVectors(hipAt(leg, at), leg.anchor).dot(leftOf(at.yaw, _l)) * leg.sign;
  // (each planted foot strayed from its hip no further than it is now — walking, `STRAYED` of its stray at most past it: one already past
  // steps in its turn; held back for it, the body stood waiting on a foot that waits on its turn, a slow horse curving after its groom
  // stopping and going. A trot's diagonals, a quarter cycle quicker, keep to it: let on, a dog's hoof lost its contact)
  const current = forecast(0), walking = clock?.walking ?? true;
  const strays = legs.map((leg) => leg.swing || !walking ? 0 : Math.min(STRAYED * (feet.legs[leg.i].stray ?? THRESHOLDS.medial * st.scale), Math.max(0, strayPast(st, feet, leg, inwardOf(leg, current)))));
  const within = (leg: Leg, ahead: number, pitches: readonly number[]) => {
    const at = forecast(ahead), build = feet.legs[leg.i], up = build.up ?? 0;
    // (and turned no further from a planted foot than the pelvis may — a gait's pivots in place on the floor as far as the body turns
    // — the hip not in over it nor a stance's travel past it)
    if (!clock && !leg.swing && Math.abs(wrapAngle(at.yaw - leg.yaw + leg.sign * st.toeOut)) > steps.pelvisTurn) return false;
    if (!leg.swing && strayPast(st, feet, leg, inwardOf(leg, at)) > strays[leg.i] + 1e-6) return false;
    const hip = hipAt(leg, at);
    if (!leg.swing && _b.subVectors(hip, leg.anchor).dot(forwardOf(leg.yaw, _f)) > steps.most) return false;
    // (a gait's planted foot that pivots will have turned in place with the body by then)
    const pivot = !leg.swing && clock ? feet.turnAbout : undefined;
    const anchor = pivot ? _pivot.copy(leg.anchor) : leg.anchor, yaw = pivot ? at.yaw + leg.sign * st.toeOut : leg.yaw;
    return pitches.some((pitch) => {
      if (pivot) pivot.call(feet, leg.i, anchor.copy(leg.anchor), leg.yaw, yaw, pitch);
      const ankle = feet.ankle(leg.i, anchor, yaw, pitch, _a);
      const most = st.reach * (build.length ?? feet.length), depth = build.depth;
      if (depth) return depth(_n.subVectors(ankle, hip).dot(leftOf(at.yaw, _l)) * leg.sign, _n.dot(forwardOf(at.yaw, _f)), pitch) >= steps.low + up - ankle.y;
      return Math.hypot(ankle.x - hip.x, ankle.z - hip.z) ** 2 + Math.max(0, steps.low + up - ankle.y) ** 2 <= most * most;
    });
  };
  // (balance first: a walker's extrapolated centre of mass kept within the feet as they stand and land — no further past them than it is;
  // a landing still re-aimed where it lands for this forecast, as `move` would aim it: judged where it was aimed for the last forecast,
  // a forecast would pass one sub-step and fail the next, once the landing is re-aimed for it — the root flipping between turning and
  // not each sub-step, the foot landing where either had it)
  if (st.capture !== undefined && legs.some((leg) => leg.swing)) {
    const landings = aim(steps, forecast);
    const support = hullOf(legs.flatMap((leg, k) => feet.print(leg.i, landings[k], leg.yaw)));
    const xcom = (t: number) => {
      const at = forecast(t).position;
      return xcomOf(at, _c.subVectors(forecast(t + SUBSTEP).position, at).divideScalar(SUBSTEP), feet.length, _x);
    };
    const allowed = Math.max(st.capture * st.scale, outside(support, xcom(0)));
    const rest = Math.max(...legs.map((leg) => leg.swing ? remaining(leg.swing) : 0));
    for (let t = rest / 4; t <= rest + 1e-9; t += rest / 4) if (outside(support, xcom(t)) > allowed + 1e-6) return false;
  }
  return legs.every((leg) => {
    const w = leg.swing;
    if (w) {
      // (turned no further from a swinging foot, as it turns on to its landing, than the pelvis may: nor further than it is already)
      const turned = (t: number) => {
        const facing = forecast(t).yaw, foot = quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, remaining(w), t)[0];
        return Math.abs(wrapAngle(facing - foot + leg.sign * st.toeOut));
      };
      const allowed = Math.max(steps.pelvisTurn, turned(0)), rest = remaining(w);
      for (let t = rest / 4; t <= rest + 1e-9; t += rest / 4) if (turned(t) > allowed + 1e-6) return false;
      // (a gait's landing, frozen once aimed, is kept within reach from then on: its body's forecast may turn out slower)
      if (w.u < (clock ? AIMED : SETTLE)) return true;
      if (!within(leg, rest, [0])) return false;
      // Touchdown alone is not enough: the root needs time to brake while this foot supports it. Look into the
      // first stance over the same horizon as a planted walking foot, so it brakes before contact is lost.
      const stance = Math.min(steps.Ts, AWAIT * steps.cycle);
      if (clock) for (let n = 1; n <= 6; n++) if (!within(leg, rest + stance * n / 6, [0, st.pitch.ball])) return false;
      return true;
    }
    const other = legs[pair[leg.i]].swing;
    const wait = clock ? clock.wait(leg, steps.cycle, steps.moving, steps.input) : other ? remaining(other) : 0;
    for (let t = 0; t <= wait + 1e-9; t += Math.max(1 / 60, wait / 6)) if (!within(leg, t, [0, st.pitch.heel, st.pitch.ball])) return false;
    return true;
  });
}

/** Where the feet will land for another forecast: those still re-aimed as the last sub-step's would be, for it. */
function aim(steps: Steps, forecast: Forecast): Vector3[] {
  const input = steps.input;
  if (!input) return steps.legs.map((leg) => leg.anchor);
  const { r } = input, was = r.forecast;
  r.forecast = forecast;
  try {
    return steps.legs.map((leg) => {
      const w = leg.swing;
      if (!w || input.airborne || w.u >= AIMED || (w.age >= remaining(w) && !w.capture)) return leg.anchor;
      // (kept within reach of the hip as `settle` keeps it)
      const anchor = leg.anchor, aimed = landing(steps, input, leg, remaining(w))[0];
      leg.anchor = aimed;
      settle(steps, input, leg, w, false);
      leg.anchor = anchor;
      return aimed;
    });
  } finally { r.forecast = was; }
}

/** Tuned: a planted foot already strayed from its hip goes on no further past it than it is, up to `STRAYED` of its stray */
const STRAYED = 0.25;
/** Tuned: how far ahead (s) a person's pace is read for whether it runs */
const PACING = 0.4;
const [_w, _a, _b, _c, _x, _n, _l, _f, _m, _o, _pivot] = Array.from({ length: 11 }, () => new Vector3());
