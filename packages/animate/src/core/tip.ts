import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import type { Frame } from './body';
import { brake } from './brake';
import type { Carrier } from './carrier';
import { solveChain } from './chain';
import { follow, followRotation } from './follow';
import { live, REACHED, type Behaviour, type Live, type Motion, type Target, type Until } from './goal';
import type { ReadonlyPose } from './pose';

/** How a chain's tip goes to its target. */
export interface TipOptions<W> extends Motion {
  /** where a two-segment chain's middle joint bends toward (world) */
  pole?: Live<Vector3, W>;
  /** the target is on this carrier, in its frame: the tip goes with it */
  on?: Carrier;
}

/**
 * The tip of the skeleton's chain `chain` toward `target`, one sub-step: it moves on from its
 * history (`follow`; a rotation needs `turnAccel`, `followRotation`) — out to all but the chain's
 * full length —, the chain is solved to it
 * (`solveChain`) and, with `turnAccel`, every joint of the chain is braked to it (`brake`, its
 * memory of the joints' goals `goals`: one per behaviour calling it).
 */
export function tipTo<W>(f: Frame<W>, chain: string, target: Live<Target, W>, options: TipOptions<W>, goals: Map<number, Quaternion>): void {
  const bones = f.current.skeleton.chain(chain);
  const tip = tipOf(f, chain);
  const t = live(target, f);
  const { on, accel, speed, turnAccel, turnSpeed } = options;
  const position = follow(f.prev2.position(tip), f.prev.position(tip), t.position, { accel, speed, velocity: t.velocity, on }, f.dt, _position);
  let quaternion: Quaternion | undefined;
  if (t.quaternion) {
    if (turnAccel === undefined) throw new Error(`chain "${chain}": a target rotation needs a turnAccel`);
    const goal = t.axis ? rolled(t.quaternion, t.axis, near(f.prev.rotation(tip), on)) : t.quaternion;
    quaternion = followRotation(f.prev2.rotation(tip), f.prev.rotation(tip), goal, { accel: turnAccel, speed: turnSpeed, velocity: t.spin, on }, f.dt, _quaternion);
  }
  // (no further than all but the chain's full length: a chain pulled straight swivels on any wobble)
  const base = f.current.position(bones[0]);
  const length = bones.slice(1).reduce((sum, b) => sum + f.current.skeleton.bones[b].offset.length(), 0);
  const out = position.distanceTo(base);
  if (out > REACH * length) position.sub(base).multiplyScalar((REACH * length) / out).add(base);
  solveChain(f, chain, { tip: { position, quaternion }, pole: options.pole === undefined ? undefined : live(options.pole, f) });
  if (turnAccel !== undefined) brake(f, bones, { accel: turnAccel, speed: turnSpeed }, goals);
}

/** A chain's tip moved to `target` (`tipTo`) every sub-step: endless, or until `until`. */
export function chainTo<W>(chain: string, target: Live<Target, W>, options: TipOptions<W> & { until?: Until<W> }): Behaviour<W> {
  const { until } = options;
  return function* () {
    const goals = new Map<number, Quaternion>();
    yield* action<Frame<W>>({
      update: (f) => void tipTo(f, chain, target, options, goals),
      until: until === 'reached' ? (f) => reached(f.prev, f.prev2, f.dt, tipOf(f, chain), live(target, f), options.on) : until,
    });
  };
}

/**
 * Bone `tip` of a body (its last poses `prev`, `prev2`, `dt` apart) is on `target` (on a carrier, in
 * its frame): within REACHED's distance and angle, and moving with it to within its speed.
 */
export function reached(prev: ReadonlyPose, prev2: ReadonlyPose, dt: number, tip: number, target: Target, on?: Carrier): boolean {
  let goal = target.position;
  const velocity = _velocity.copy(target.velocity ?? ZERO);
  if (on) {
    on.toWorld(target, _goal);
    goal = _goal.position;
    velocity.applyQuaternion(on.current.quaternion).add(_goal.velocity);
  }
  const at = prev.position(tip);
  const moving = _v.subVectors(at, prev2.position(tip)).divideScalar(dt).sub(velocity);
  if (at.distanceTo(goal) > REACHED.distance || moving.length() > REACHED.speed) return false;
  if (!target.quaternion) return true;
  // (in the frame the target is given in, rolled about its axis as near the tip as it may be)
  const turned = near(prev.rotation(tip), on);
  return (target.axis ? rolled(target.quaternion, target.axis, turned) : target.quaternion).angleTo(turned) <= REACHED.angle;
}

/** a world rotation in the frame a target is given in: on a carrier, its (as it is now) */
function near(world: Readonly<Quaternion>, on?: Carrier): Quaternion {
  return on ? _near.copy(on.current.quaternion).invert().multiply(world) : _near.copy(world);
}

/** of `q` rolled about `axis` (both in one frame), the rotation nearest `near` (in it too), into a shared quaternion */
function rolled(q: Quaternion, axis: Vector3, near: Readonly<Quaternion>): Quaternion {
  const a = _axis.copy(axis).normalize();
  // the turn from q to `near`, its part about the axis
  const d = _d.copy(near).multiply(_roll.copy(q).invert());
  const angle = 2 * Math.atan2(d.x * a.x + d.y * a.y + d.z * a.z, d.w);
  return _roll.setFromAxisAngle(a, angle).multiply(q);
}

/** the share of a chain's length its tip is moved out to at most */
const REACH = 0.98;
const ZERO = new Vector3();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _v = new Vector3();
const _axis = new Vector3();
const _d = new Quaternion();
const _roll = new Quaternion();
const _near = new Quaternion();
const _velocity = new Vector3();
const _goal: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };

/** the tip bone of chain `chain` */
function tipOf<W>(f: Frame<W>, chain: string): number {
  const bones = f.current.skeleton.chain(chain);
  return bones[bones.length - 1];
}
