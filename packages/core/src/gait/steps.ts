import { Vector3 } from 'three';
import { clamp, hypot, lerp, wrapAngle } from '../math';
import type { Gait } from './gait';
import { heightAlong, inWall, overSpan } from './obstacles';
import { desiredAnchor, fitLanding, refitLanding, uncaughtBy } from './placement';
import { leadTime, type Timing } from './timing';

/** the extrapolated centre of mass is caught by a step once it leaves the feet by this much (m, default body) */
export const CATCH = 0.02;
/** how much better a step with the foot that just landed must catch the body to break the alternation (m, default body) */
const ALTERNATE = 0.08;
/** the shortest step standing still (m): a stance this far off is squared up */
const SETTLE = 0.04;
/** a foot further than this (× height) from the root must step regardless of rhythm */
const MAX_DEVIATION = 0.42;
/** a foot stepping down lands on its forefoot, the ankle plantarflexed (rad; 15–25°, Riener 2002) */
const STEP_DOWN = -0.35;
/** stepping up, the swing's ankle rises this share of the riser over its straight path: the knee comes up to ~95° (Riener 2002: 90–100°) */
const STEP_UP_LIFT = 0.8;

const _v = new Vector3();
/** how far each foot is from where it should be: position and its sideways part (m), heading (rad) */
const _errs = new Float64Array(2);
const _lateral = new Float64Array(2);
const _yawErrs = new Float64Array(2);

/** Decide whether a foot lifts now, and which. */
export function triggerStep(g: Gait, t: Timing) {
  const { feet } = g;
  if (feet[0].phase === 'lifted' || feet[1].phase === 'lifted') return;
  if (t.run > 0.5) {
    // running: a step clock — each foot pushes off half a stride after the other did,
    // even while the other is still in the air (flight phase), so the rhythm stays
    // locked to the speed (no drifting, no hopping in sync)
    const s = 1 - g.lastLift;
    const f = feet[s];
    if (f.phase === 'planted' && g.clock - g.lastLiftAt >= t.stepT && f.plantedTime >= 0.6 * t.stance) startSwing(g, s, t);
    return;
  }
  if (feet[0].phase === 'swing' || feet[1].phase === 'swing') return;
  // a foot a wall moves into (a crate pulled back onto it) steps out of its way first
  for (let s = 0; s < 2; s++) {
    const f = feet[s];
    if (feet[1 - s].plantedTime > 0.05 && inWall(g.steer.floorObstacles, f.anchor.x, f.anchor.z, Math.sin(f.yaw), Math.cos(f.yaw), g.d)) return startSwing(g, s, t, true);
  }
  const lead = g.moving ? leadTime(t, t.swing) : 0;
  // capture-point stepping: a body falling past its feet steps now, with the foot that
  // catches it; otherwise the rhythm's step, unless it would let the body fall
  const out = g.capture.outside(feet[0].anchor, feet[0].yaw, feet[1].anchor, feet[1].yaw);
  const falling = out > CATCH * g.d.scale;
  // (a foot target holds the stepping while the weight shifts for it, and a stride while the
  // body goes onto it — but not a fall)
  if ((g.footHeld || g.striding) && !falling) return;
  const pick = falling ? catching(g, t, lead) : balanced(g, pickFoot(g, t), t, lead);
  if (pick >= 0) startSwing(g, pick, t, falling);
}

/**
 * How far the extrapolated centre of mass would lie outside the base a step with foot `s`
 * leaves: the other foot and the landing (as fitted to the body, landing `ahead` s from
 * now; the way around obstacles is left to the step itself).
 */
function uncaught(g: Gait, s: number, lead: number, ahead: number): number {
  return refitLanding(g, s, _v, desiredAnchor(g, s, lead, _v), ahead);
}

/**
 * The foot whose step catches a body falling past its feet: the rhythm's next one if it can,
 * else the one that helps most (−1: neither helps).
 */
function catching(g: Gait, t: Timing, lead: number): number {
  const next = 1 - g.lastLanded;
  const byNext = uncaught(g, next, lead, t.swing);
  if (byNext <= CATCH * g.d.scale) return next;
  // (judged alike: by the point as it will be when the step lands)
  const f = g.feet[next];
  const out = uncaughtBy(g, next, f.anchor, f.yaw, t.swing);
  const byOther = uncaught(g, 1 - next, lead, t.swing) + rhythmCost(g, 1 - next, t);
  if (Math.min(byNext, byOther) >= out) return -1;
  return byOther < byNext ? 1 - next : next;
}

/**
 * What stepping again with the foot that just landed costs (m of uncaught centre of mass):
 * it is still taking the weight, so the feet alternate unless that clearly catches better.
 */
const rhythmCost = (g: Gait, s: number, t: Timing) => (g.feet[s].plantedTime < t.stance ? ALTERNATE * g.d.scale : 0);

/**
 * `pick`, unless its step would let the body fall past its feet and the other foot's would
 * catch it (better): one that cannot either keeps the rhythm (a side-step's closing step
 * brings the base along for the leading foot to catch the next)
 */
function balanced(g: Gait, pick: number, t: Timing, lead: number): number {
  if (pick < 0) return pick;
  const out = uncaught(g, pick, lead, t.swing);
  if (out <= CATCH * g.d.scale) return pick;
  const other = uncaught(g, 1 - pick, lead, t.swing);
  return other <= CATCH * g.d.scale && other + rhythmCost(g, 1 - pick, t) < out ? 1 - pick : pick;
}

/** the foot to step with (−1: none) while walking or standing */
function pickFoot(g: Gait, t: Timing): number {
  const { feet, d } = g;
  const speed = g.speed;
  const errs = _errs;
  const yawErrs = _yawErrs;
  const lead = g.moving ? leadTime(t, t.swing) : 0;
  for (let s = 0; s < 2; s++) {
    const yaw = desiredAnchor(g, s, lead, _v);
    const dx = _v.x - feet[s].anchor.x;
    const dz = _v.z - feet[s].anchor.z;
    errs[s] = hypot(dx, dz);
    // (across the stance as it stands: bladed, a stagger is no sideways error)
    const across = g.root.yaw + g.stance.blade;
    _lateral[s] = Math.abs(dx * Math.cos(across) - dz * Math.sin(across));
    yawErrs[s] = Math.abs(wrapAngle(yaw - feet[s].yaw));
  }
  let pick = -1;
  // a foot left far behind (or ahead) must step regardless of rhythm
  for (let s = 0; s < 2; s++) {
    const dev = hypot(feet[s].anchor.x - g.root.x, feet[s].anchor.z - g.root.z);
    if (dev > MAX_DEVIATION * d.height && feet[1 - s].plantedTime > 0.05) pick = s;
  }
  if (pick < 0 && (g.moving || speed > 0.05)) pick = pickWhileMoving(g, t, lead);
  else if (pick < 0) {
    // crouched: skip fussy adjustments, but a foot left far behind must still follow
    const k = g.steer.crouched && Math.max(errs[0], errs[1]) < 0.3 ? 5 : 1;
    const best = offBy(0, k) >= offBy(1, k) ? 0 : 1;
    const otherLoaded = feet[1 - best].plantedTime > 0.12;
    if (offBy(best, k) > 1 && otherLoaded) pick = best;
    // finish the pair: bring the other foot alongside after an adjustment
    else if (k === 1 && otherLoaded && (errs[best] > 0.1 || yawErrs[best] > 0.45) && feet[best].plantedTime > 0.35) pick = best;
  }
  if (pick >= 0 && !g.moving && speed < 0.05) {
    // an idle adjustment must actually move the foot somewhere
    const f = feet[pick];
    const yaw = desiredAnchor(g, pick, 0, _v);
    fitLanding(g, pick, _v, yaw, t.swing);
    if (hypot(_v.x - f.anchor.x, _v.z - f.anchor.z) < SETTLE && Math.abs(wrapAngle(yaw - f.yaw)) < 0.3) pick = -1;
  }
  return pick;
}

/**
 * Alternate by default, but the foot that needs it most (and can make progress) leads:
 * side-steps lead with the foot on that side.
 */
function pickWhileMoving(g: Gait, t: Timing, lead: number): number {
  const { feet } = g;
  let last = g.lastLanded;
  // setting off: the foot on the side of the goal leads (no stepping across)
  if (feet[0].plantedTime > 0.3 && feet[1].plantedTime > 0.3) {
    const gx = g.target.x - g.root.x;
    const gz = g.target.z - g.root.z;
    const gl = hypot(gx, gz);
    const gLat = gx * Math.cos(g.root.yaw) - gz * Math.sin(g.root.yaw);
    if (gl > 0.02 && Math.abs(gLat) > 0.3 * gl) last = gLat > 0 ? 1 : 0;
  }
  const next = 1 - last;
  const lastLoaded = feet[last].plantedTime >= t.doubleSupport;
  const nextLoaded = feet[next].plantedTime >= t.doubleSupport;
  const progress = (s: number) => stepProgress(g, s, lead, t.swing);
  if (g.starting && lastLoaded && nextLoaded && progress(next) >= 0.1) return next;
  // slow repositioning: only steps that are worth a step
  const minMove = g.speed < 0.3 ? 0.05 : 0.02;
  // and nobody walks in a deep squat unless a foot is badly out of place
  const squatHold = g.steer.crouched && g.speed < 0.35 && Math.max(_errs[0], _errs[1]) < 0.3;
  if (squatHold || !lastLoaded || misplaced(next) <= (g.speed < 0.3 ? 0.06 : 0.03)) return -1;
  const lastInstead =
    nextLoaded && misplaced(last) > 0.03 && progress(last) >= minMove && (progress(next) < minMove || misplaced(last) > 1.5 * misplaced(next) + 0.03);
  if (lastInstead) return last;
  return progress(next) >= minMove ? next : -1;
}

/**
 * how far foot `s` is out of place, in units of what's worth a step (crouched: `k` × more):
 * a stance a few cm too narrow, too wide or off to one side is squared up
 */
const offBy = (s: number, k: number) => Math.max(_errs[s] / (0.1 * k), _lateral[s] / (SETTLE * k), _yawErrs[s] / (0.45 * k));

/** how far foot `s` is out of place while moving (m, with its heading error) */
const misplaced = (s: number) => _errs[s] + 0.25 * _yawErrs[s];

/** how far a step of foot `s`, landing `ahead` s from now, would actually move it */
function stepProgress(g: Gait, s: number, lead: number, ahead: number): number {
  fitLanding(g, s, _v, desiredAnchor(g, s, lead, _v), ahead);
  return hypot(_v.x - g.feet[s].anchor.x, _v.z - g.feet[s].anchor.z);
}

/** Lift foot `s` into a swing toward its placement (unless the step is too small to bother, and it isn't `catching` the body). */
function startSwing(g: Gait, s: number, t: Timing, catching = false) {
  const { d } = g;
  const f = g.feet[s];
  const w = f.swing;
  const swingTime = t.swing;
  g.lastLift = s;
  g.lastLiftAt = g.clock;
  const lead = g.moving ? leadTime(t, swingTime) : 0;
  w.toYaw = desiredAnchor(g, s, lead, w.to);
  const planned = fitLanding(g, s, w.to, w.toYaw, swingTime);
  const stepLen = hypot(w.to.x - f.anchor.x, w.to.z - f.anchor.z);
  const H = d.scale;
  // nobody lifts a foot to move it a couple of centimetres (standing, a stance squared up by a few is worth it)
  if (!catching && stepLen < (g.moving ? 0.1 : SETTLE) * H && Math.abs(wrapAngle(w.toYaw - f.yaw)) < 0.45) return;
  f.phase = 'swing';
  f.strided = false;
  w.s = 0;
  // short steps are quick; long walking strides follow the cadence
  w.duration = t.run > 0.5 ? swingTime : clamp(0.24 + 0.32 * (stepLen / H), 0.28, g.moving ? swingTime : 0.45);
  // the ankle's rise over its path as the knee flexes: ~9 cm walking, ~29 cm running
  // (CMU mocap); pivots and tiny adjustments barely clear the floor
  w.lift = (stepLen < 0.06 ? 0.015 : lerp(clamp(0.07 * stepLen, 0.03, 0.09), 0.17, t.run)) * H;
  w.strikePitch = g.moving ? lerp(0.28 * g.walk + 0.04, 0.12, t.run) : 0.04;
  w.from.copy(f.pose.ankle);
  w.fromYaw = f.yaw;
  // anything to step over on the way? (toe-obstacle clearance ~10 cm, as people do)
  const h = heightAlong(g, f.anchor, w.to);
  w.clear = h > 0 ? h + d.ankleHeight + 0.1 * H : 0;
  // a high step is a little slower, and so is one up or down: stepping down, the forefoot lands first (Riener 2002)
  if (w.clear > 0) overSpan(g, w);
  const rise = w.to.y - f.anchor.y;
  if (w.clear > 0) w.duration *= 1.35;
  else if (Math.abs(rise) > 0.01) w.duration *= 1.1;
  w.early = w.clear > 0 || Math.abs(rise) > 0.01;
  // (and stepping up, flat onto the tread, the knee lifted high to bring the foot over the nose:
  // the knee and hip are what lift the body)
  if (Math.abs(rise) > 0.01) w.strikePitch = rise < 0 ? STEP_DOWN : 0;
  if (rise > 0.01) w.lift = Math.max(w.lift, STEP_UP_LIFT * rise);
  // (a swing covers a stride — two steps — in two step times)
  w.pace = planned || w.clear > 0 ? stepLen / (2 * (w.duration + t.doubleSupport)) : Infinity;
}
