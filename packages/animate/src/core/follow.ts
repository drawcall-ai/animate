import { Quaternion, Vector3 } from 'three';
import { exp, log } from './rotation';

/** How a value may move toward its goal. */
export interface FollowOptions<V> {
  /** the most its velocity changes (per s², in its units) */
  accel: number;
  /** the most it closes in on the goal (per s; default unbounded) */
  speed?: number;
  /**
   * the goal's own velocity (per s; for a rotation, its angular velocity in the world, rad/s),
   * added to the approach: a goal moving steadily is then followed without lag (default still)
   */
  velocity?: V;
}

/**
 * The next value of something moving toward `target` from its history (`prev2`, `prev`) over
 * `dt`, as fast as `options` allow: it closes in at most at `speed`, and no faster than it can
 * still brake to the goal in steps of `dt` at `accel` (`brakingSpeed`), and its velocity changes
 * by at most `accel · dt` per step. So it never overshoots a still target, hands over
 * continuously from any motion it has, and, given the goal's velocity, follows a steadily
 * moving goal exactly.
 */
export function follow(prev2: number, prev: number, target: number, options: FollowOptions<number>, dt: number): number;
export function follow(prev2: Vector3, prev: Vector3, target: Vector3, options: FollowOptions<Vector3>, dt: number, out?: Vector3): Vector3;
export function follow(
  prev2: number | Vector3,
  prev: number | Vector3,
  target: number | Vector3,
  options: FollowOptions<number> | FollowOptions<Vector3>,
  dt: number,
  out = new Vector3(),
): number | Vector3 {
  const p = vector(prev, _p);
  const goal = vector(options.velocity ?? 0, _g);
  const velocity = vector(prev, _v).sub(vector(prev2, _a)).divideScalar(dt);
  // the goal where it was a step ago: the approach is to that, then moved with it
  const gap = vector(target, _d).addScaledVector(goal, -dt).sub(p);
  step(velocity, gap, goal, options, dt);
  const next = p.addScaledVector(velocity, dt);
  return typeof prev === 'number' ? next.x : out.copy(next);
}

/** `follow` for a rotation: velocities are angular velocities in the world, steps rotation vectors (`next = exp(ω·dt) · prev`). */
export function followRotation(prev2: Quaternion, prev: Quaternion, target: Quaternion, options: FollowOptions<Vector3>, dt: number, out = new Quaternion()): Quaternion {
  const goal = _g.copy(options.velocity ?? ZERO);
  const velocity = log(_q.copy(prev2).invert().premultiply(prev), _v).divideScalar(dt);
  // (the goal a step ago: exp(−ω·dt) · target)
  const was = exp(-goal.x * dt, -goal.y * dt, -goal.z * dt, _q).multiply(target);
  const gap = log(was.multiply(_r.copy(prev).invert()), _d);
  step(velocity, gap, goal, options, dt);
  velocity.multiplyScalar(dt);
  return out.copy(prev).premultiply(exp(velocity.x, velocity.y, velocity.z, _q)).normalize();
}

/** turns `velocity` into the next step's: toward `gap` (from the goal a step ago), braking in time, plus the goal's own `goal` */
function step(velocity: Vector3, gap: Vector3, goal: Vector3, { accel: a, speed = Infinity }: FollowOptions<unknown>, dt: number) {
  if (!(a > 0)) throw new Error(`an acceleration of ${a}`);
  const d = gap.length();
  const approach = Math.min(speed, brakingSpeed(d, a, dt));
  const wanted = d > 0 ? gap.multiplyScalar(approach / d).add(goal) : gap.copy(goal);
  const change = wanted.sub(velocity);
  const most = a * dt;
  if (change.length() > most) change.setLength(most);
  velocity.add(change);
}

/**
 * The fastest speed from which steps of `dt`, slowing by `a · dt` each, stop within `d`: with
 * K = d / (a·dt²) and n = ⌊(√(8K + 1) − 1) / 2⌋ steps after this one, a·dt · (K / (n + 1) + n / 2).
 * Where it stops exactly after whole steps it is √(a²dt²/4 + 2ad) − a·dt/2; between those, that
 * formula would overshoot by up to a·dt²/8. Near the goal (n = 0) it is d / dt: arriving.
 */
function brakingSpeed(d: number, a: number, dt: number): number {
  const k = d / (a * dt * dt);
  const n = Math.floor((Math.sqrt(8 * k + 1) - 1) / 2);
  return a * dt * (k / (n + 1) + n / 2);
}

function vector(v: number | Vector3, out: Vector3): Vector3 {
  return typeof v === 'number' ? out.set(v, 0, 0) : out.copy(v);
}

const ZERO = new Vector3();
const _p = new Vector3();
const _g = new Vector3();
const _v = new Vector3();
const _a = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const _r = new Quaternion();
