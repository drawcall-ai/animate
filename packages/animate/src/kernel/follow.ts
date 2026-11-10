import { Quaternion, Vector3 } from 'three';
import type { FollowOptions, Motion, Placement } from './goal';
import { exp, log, spinOf } from './rotation';

/**
 * The next value of something moving toward `target` from its history (`prev2`, `prev`) over `dt`, as fast as `options` allow: it
 * closes in at most at `speed`, and no faster than it can still brake to the goal in steps of `dt` at `accel`, and its velocity
 * changes by at most `accel · dt` per step, braking toward the goal before anything else. So it hands over continuously from any
 * motion it has; given the goal's velocity, it follows a steadily moving goal exactly; and it never passes a still goal it moves
 * straight at (or starts still for) unless it is too fast to brake in time. Velocity across the line to the goal turns with what is
 * left of the acceleration and can carry it past the goal, by up to about 1.25 · v⊥² / accel. The history is read as taken `dt` apart:
 * step it evenly (a body's sub-steps are). On a moving frame (`on`), the goal is in its frame and the history is read in its frame as it
 * was then: the value moves with the moving frame, and toward the goal on it.
 */
export function follow(prev2: number, prev: number, target: number, options: Omit<FollowOptions<number>, 'on'>, dt: number): number;
export function follow(prev2: Vector3, prev: Vector3, target: Vector3, options: FollowOptions<Vector3>, dt: number, out?: Vector3): Vector3;
export function follow(
  prev2: number | Vector3,
  prev: number | Vector3,
  target: number | Vector3,
  options: Omit<FollowOptions<number>, 'on'> | FollowOptions<Vector3>,
  dt: number,
  out = new Vector3(),
): number | Vector3 {
  const on = 'on' in options ? options.on : undefined;
  const p = vector(prev, _p);
  const was = vector(prev2, _a);
  if (on) {
    toLocal(on.prev, p);
    toLocal(on.prev2, was);
  }
  const goal = vector(options.velocity ?? 0, _g);
  const velocity = _v.copy(p).sub(was).divideScalar(dt);
  // the goal where it was a step ago: the approach is to that, then moved with it
  const gap = vector(target, _d).addScaledVector(goal, -dt).sub(p);
  // A caught point has no reliable braking direction inside the IK positional fitting tolerance.
  step(velocity, gap, goal, options, dt, 1e-9);
  const next = p.addScaledVector(velocity, dt);
  if (on) next.applyQuaternion(on.current.quaternion).add(on.current.position);
  return typeof prev === 'number' ? next.x : out.copy(next);
}

/**
 * `follow` for a rotation: velocities are angular velocities and steps rotation vectors (`next = exp(ω·dt) · prev`) in the frame the
 * quaternions are in — the world for world rotations, the parent's for a bone's local ones. A step of more than half a turn per `dt`
 * is read the short way round.
 */
export function followRotation(prev2: Quaternion, prev: Quaternion, target: Quaternion, options: FollowOptions<Vector3>, dt: number, out = new Quaternion()): Quaternion {
  const { on } = options;
  const p = _p2.copy(prev);
  const p2 = _p3.copy(prev2);
  if (on) {
    p.premultiply(_r.copy(on.prev.quaternion).invert());
    p2.premultiply(_r.copy(on.prev2.quaternion).invert());
  }
  const goal = _g.copy(options.velocity ?? ZERO);
  const velocity = log(_q.copy(p2).invert().premultiply(p), _v).divideScalar(dt);
  // (the goal a step ago: exp(−ω·dt) · target)
  const was = exp(-goal.x * dt, -goal.y * dt, -goal.z * dt, _q).multiply(target);
  const gap = log(was.multiply(_r.copy(p).invert()), _d);
  // Within the IK solver's 1e-9 rad fitting tolerance, do not choose a braking axis from quaternion-product roundoff.
  step(velocity, gap, goal, options, dt, 1e-9);
  velocity.multiplyScalar(dt);
  out.copy(p).premultiply(exp(velocity.x, velocity.y, velocity.z, _q)).normalize();
  return on ? out.premultiply(on.current.quaternion) : out;
}

/** `world` into a moving frame placed `at` */
export function toLocal(at: Placement, world: Vector3): Vector3 {
  return world.sub(at.position).applyQuaternion(_r.copy(at.quaternion).invert());
}

/** turns `velocity` into the next step's: toward `gap` (from the goal a step ago), braking in time, plus the goal's own `goal` */
function step(velocity: Vector3, gap: Vector3, goal: Vector3, { accel: a, speed = Infinity }: { accel: number; speed?: number }, dt: number, roundoff = 0) {
  if (!(a > 0 && Number.isFinite(a))) throw new Error(`an acceleration of ${a}`);
  if (!(speed >= 0)) throw new Error(`a speed of ${speed}`);
  if (!(dt > 0 && Number.isFinite(dt))) throw new Error(`a step of ${dt} s`);
  const d = gap.length();
  if (!Number.isFinite(d) || !Number.isFinite(velocity.lengthSq())) throw new Error('a goal, history or goal velocity that is not finite');
  const approach = Math.min(speed, brakingSpeed(d, a, dt));
  const dir = d > roundoff ? _u.copy(gap).divideScalar(d) : _u.set(0, 0, 0);
  const wanted = d > 0 ? gap.multiplyScalar(approach / d).add(goal) : gap.copy(goal);
  const change = wanted.sub(velocity);
  const most = a * dt;
  if (change.length() > most) {
    // braking toward the goal first: what is left turns the rest
    const brake = Math.max(-most, Math.min(0, change.dot(dir)));
    const rest = change.addScaledVector(dir, -brake);
    const left = Math.sqrt(most * most - brake * brake);
    if (rest.length() > left) rest.setLength(left);
    rest.addScaledVector(dir, brake);
  }
  velocity.add(change);
}

/** The fastest speed from which steps of `dt`, slowing by `a · dt` each, stop within `d`: with K = d / (a·dt²) and
 * n = ⌊(√(8K + 1) − 1) / 2⌋ steps after this one, a·dt · (K / (n + 1) + n / 2). Where it stops exactly after whole steps it is
 * √(a²dt²/4 + 2ad) − a·dt/2; between those, that formula would overshoot by up to a·dt²/8. Near the goal (n = 0) it is d / dt: arriving. */
function brakingSpeed(d: number, a: number, dt: number): number {
  const k = d / (a * dt * dt);
  const n = Math.floor((Math.sqrt(8 * k + 1) - 1) / 2);
  return a * dt * (k / (n + 1) + n / 2);
}

function vector(v: number | Vector3, out: Vector3): Vector3 {
  return typeof v === 'number' ? out.set(v, 0, 0) : out.copy(v);
}

const ZERO = new Vector3();
const [_u, _p, _g, _v, _a, _d] = Array.from({ length: 6 }, () => new Vector3());
const [_q, _r, _p2, _p3] = Array.from({ length: 4 }, () => new Quaternion());
const _from = new Vector3();

/** How a moving goal is followed: `Motion`'s acceleration and speed. */
type GoalPace = Pick<Motion, 'accel' | 'speed'>;

/** Follow finite-difference goal velocity without lag; brake jumps and treat the first sample as stationary. One sampler per goal. */
export class PointFollower {
  private readonly sample = new PointVelocity();
  /** the goal's velocity as last sampled */
  private readonly was = new Vector3();

  /** A goal moving faster than the pace's speed jumped: it is braked to as at rest, not followed in its motion — unless it is `carried`
   * with what follows it (a place on the follower's own body), which is followed in its motion however fast it goes, and whose changes of
   * pace (the body taking off, landing) carry the follower with it at once, only its way to the goal braked: braked to the goal's new
   * pace as to its own, a thing kept on a place on the chest fell 5 cm behind it as the body took off */
  follow(prev2: Readonly<Vector3>, prev: Readonly<Vector3>, goal: Readonly<Vector3>, pace: GoalPace, dt: number, out: Vector3, carried = false): Vector3 {
    const velocity = this.sample.read(goal, dt, carried ? Infinity : pace.speed);
    // (its history read as if it had changed pace with the goal)
    const from = carried ? _from.copy(prev2).addScaledVector(this.was, dt).addScaledVector(velocity, -dt) : prev2;
    this.was.copy(velocity);
    return follow(from, prev, goal, { ...pace, velocity }, dt, out);
  }
}

/** Finite-difference target velocity; first samples and jumps are stationary goals. */
export class PointVelocity {
  private last: Vector3 | null = null;
  private readonly velocity = new Vector3();

  read(goal: Readonly<Vector3>, dt: number, speed = Infinity): Vector3 {
    const last = (this.last ??= goal.clone());
    this.velocity.subVectors(goal, last).divideScalar(dt);
    if (!Number.isFinite(dt) || this.velocity.length() > speed) this.velocity.set(0, 0, 0);
    last.copy(goal);
    return this.velocity;
  }
}

/** `PointFollower` for a rotation (in whatever frame its quaternions are in). */
export class RotationFollower {
  private last: Quaternion | null = null;

  /** `jumpAbove`: a goal turning faster than this (rad/s; default the pace's speed) jumped: it is braked to as at rest, not followed */
  follow(prev2: Readonly<Quaternion>, prev: Readonly<Quaternion>, goal: Readonly<Quaternion>, pace: GoalPace, dt: number, out: Quaternion,
    jumpAbove = pace.speed ?? Infinity): Quaternion {
    const last = (this.last ??= goal.clone());
    const velocity = spinOf(last, goal, dt, _spin);
    if (velocity.length() > jumpAbove) velocity.set(0, 0, 0);
    last.copy(goal);
    return followRotation(prev2, prev, goal, { ...pace, velocity }, dt, out);
  }
}

const _spin = new Vector3();
