// A swing's way over a floor that is not level: up a stair the foot rises before it swings on, down one it comes over the tread first.
import { MathUtils, Vector3 } from 'three';
import { lerp, minimumJerk, quintic, wrapAngle } from '../kernel/math';
import { FLAT, highestUnder, lowestUnder } from './floor';
import type { Leg, Now, Steps, Swing } from './state';

/** how high a swing's arc lifts its foot over its path `u` through it (m): it peaks mid-swing walking; a runner's heel stays up later, the
 * knee bent late into the swing; a gait's as its `arc` has it */
export function arcOf(steps: Steps, now: Now, leg: Leg, w: Swing, u: number): number {
  const { st } = steps, a = st.gait ? st.arc : lerp(3, st.arc, w.run), peak = a / (a + 3);
  const { up, down } = stepping(steps, leg, w);
  const terrain = now.physical ? Math.max(up, down) : down;
  return w.lift * (1 - terrain) * (u ** a * (1 - u) ** 3) / (peak ** a * (1 - peak) ** 3);
}

/** how far a swing steps up and down (0 … 1 each): its landing `STEP` or more above or below the floor it left */
export function stepping(steps: Steps, leg: Leg, w: Swing): { up: number; down: number } {
  const climb = leg.anchor.y - steps.feet.ankleHeight - w.level, step = STEP * steps.st.scale;
  return { up: MathUtils.smoothstep(climb, 0, step), down: MathUtils.smoothstep(-climb, 0, step) };
}

/**
 * A swing's ankle on its way toward `land`, a sub-step of `dt` s on (minimum jerk, as its state `w` goes): on a level floor straight
 * there; else over the floor as `wayOf` has it — held, braking over `BRAKING` s; its way across and its height each in their time —
 * raised no higher than `ceiling` (m).
 */
export function swingOver(steps: Steps, now: Now, leg: Leg, w: Swing, land: Readonly<Vector3>, ceiling: number, dt: number) {
  const { across, up, pass, held, raise } = steps.floor === FLAT ? { across: w.rest, up: w.rest, pass: -Infinity, held: false, raise: 0 } : wayOf(steps, now, leg, w, land);
  // A planned walk can wait for its foot to clear a riser; a controller-driven root keeps travelling.
  for (const axis of ['x', 'z'] as const) [w.x[axis], w.v[axis], w.a[axis]] = held && !now.physical
    ? quintic(w.x[axis], w.v[axis], w.a[axis], w.x[axis] + w.v[axis] * BRAKING / 2, 0, BRAKING, dt)
    : quintic(w.x[axis], w.v[axis], w.a[axis], land[axis], 0, across, dt);
  [w.x.y, w.v.y, w.a.y] = quintic(w.x.y, w.v.y, w.a.y, Math.max(land.y, pass), 0, up, dt);
  // (raised over what it passes no higher than `ceiling`, the most its ankle reaches up under the hip: the raise is asked again each
  // sub-step, and a foot stepping back down off a block, its edge still ahead, was raised past its hip, the knee flipping through)
  const raised = Math.min(raise, ceiling - w.x.y);
  if (raised > 0 && dt < up) {
    const [x, v, a] = bump(dt / up);
    w.x.y += raised * x;
    w.v.y += raised * v / up;
    w.a.y += raised * a / up ** 2;
  }
}

/**
 * A swing's way over a floor that is not level, toward its ankle's landing `land` (recalled: footstep planners swing the foot over the
 * obstacles on its path; on stairs the foot lifts over the nosing ahead before it swings on, and comes over the tread below before it
 * steps down). Stepping up, its height leads its way across — it is up within `STAIR` sooner — and it is `held`, early in its swing,
 * while the way it covers in the next `CLEAR` s is not yet clear of the rise ahead; stepping down, its way across leads — it is over its
 * landing that much before it lands — and its ankle stays as high as it `pass`es over a floor higher than its landing's on the way still
 * ahead. `across` and `up`: how long it takes for its way across and its height (s).
 */
function wayOf(steps: Steps, now: Now, leg: Leg, w: Swing, land: Readonly<Vector3>): { across: number; up: number; pass: number; held: boolean; raise: number } {
  const { floor, feet, st } = steps, level = leg.anchor.y - feet.ankleHeight, climb = level - w.level;
  const lead = Math.min(STAIR.share * w.T, Math.abs(climb) / STAIR.speed);
  // A landing can still move; the early axis needs a remaining horizon, never a deadline already passed.
  const early = Math.max(STEP_TIME, w.rest * (1 - lead / w.T));
  const across = climb < 0 && !now.physical ? early : w.rest, up = climb > 0 ? early : w.rest;
  // (the sole read as it turns on its way, not as it will land: a foot turning about on a tread sweeps its toes over the riser behind
  // its landing's print — read at the landing's yaw, the toes went into it and the swing was lifted out of it in one sub-step, 14 cm)
  const yawAt = (t: number) => quintic(w.turn.x, w.turn.v, w.turn.a, w.turn.x + wrapAngle(leg.yaw - w.turn.x), 0, w.rest, t)[0];
  const print = feet.print(leg.i, w.x, w.turn.x);
  // (up onto a tread, its sole kept its clearance over it till it is all over the tread: its heel clear of the nosing it lands past)
  // (its sole's lowest point — a toe hanging down — kept its clearance over the floor it passes, let go over its last stretch onto its landing)
  const over = feet.ankleHeight + (w.drop - feet.ankleHeight + st.clearance * st.scale) * (1 - minimumJerk((w.u - LANDING) / (1 - LANDING)));
  let pass = climb > 0 && lowestUnder(floor, print) < level - RISE ? level + over : -Infinity, held = false, raise = 0;
  for (let k = 0; k <= AHEAD; k++) {
    const t = w.rest * k / AHEAD, u = Math.min(1, w.u + t / w.T);
    const dx = quintic(w.x.x, w.v.x, w.a.x, land.x, 0, across, t)[0] - w.x.x, dz = quintic(w.x.z, w.v.z, w.a.z, land.z, 0, across, t)[0] - w.x.z;
    const there = highestUnder(floor, feet.print(leg.i, _at.set(w.x.x + dx, 0, w.x.z + dz), yawAt(t)));
    if (now.contact && climb < -RISE) {
      // (stepping down onto physics' support, its way is raised by a bump kept from where it was first asked, as high as its sole needs
      // to clear what it passes: a bump added to its planned motion each sub-step, which the next plan did not keep, was asked again and
      // again — a foot stepping back off a block swung up past its hip)
      const [share] = bump(t / up), y = quintic(w.x.y, w.v.y, w.a.y, land.y, 0, up, t)[0];
      const clearance = feet.ankleHeight + (w.drop - feet.ankleHeight + st.clearance * st.scale) * Math.sin(Math.PI * u) ** 3;
      if (share > 1e-6) raise = Math.max(raise, (there + clearance - y) / share);
    } else if (there > level + RISE) pass = Math.max(pass, there + over);
    if (k === 0 || climb <= RISE || t > CLEAR || w.u > HOLDING || there <= w.level + RISE) continue;
    const sole = quintic(w.x.y, w.v.y, w.a.y, land.y, 0, up, t)[0] + arcOf(steps, now, leg, w, u) - w.drop;
    held ||= sole < there + st.clearance * st.scale;
  }
  return { across, up, pass, held, raise };
}

/** A bump in a swing's height over the rest of its way `u` (0 … 1): 0, peaking at 1 and back to 0, and its first and second derivatives
 * in `u` — it leaves the swing's position, speed and acceleration as they are at both ends. */
function bump(u: number): [number, number, number] {
  const rest = 1 - u;
  return [64 * u ** 3 * rest ** 3, 192 * u ** 2 * rest ** 2 * (1 - 2 * u), 384 * u * rest * (1 - 5 * u + 5 * u ** 2)];
}

/** Tuned: a swing lets go of its clearance over the floor over the last `1 − LANDING` of it */
const LANDING = 0.75;
/** Tuned: a held swing brakes over `BRAKING` s, and goes on once the way it covers in the next `CLEAR` s is clear; past `HOLDING` of
 * its swing it is held no more */
const BRAKING = 0.1, CLEAR = 0.1, HOLDING = 0.5;
/** Tuned: up or down a step, a swing's height leads its way across, or its way across its height, by the step's height over `STAIR.speed`
 * (m/s), at most `share` of the swing */
const STAIR = { speed: 1, share: 0.35 };
/** the least time a swing's way is planned over (s): a sub-step */
const STEP_TIME = 1 / 60;
/** Tuned: a floor this much higher (m) than the one a swing left is a rise it waits to clear */
export const RISE = 0.01;
/** how many moments to come a swing's way over the floor is read at */
const AHEAD = 10;
/** Tuned: a foot landing this far (m, default body) or more above or below the floor it left steps up or down: up, it lands flat; down,
 * toes first, the heel kept up over the edge it leaves (recalled: stair ascent lands on the forefoot or the whole foot, descent on the
 * forefoot), and with no arc: it only comes over the edge */
const STEP = 0.08;

const _at = new Vector3();
