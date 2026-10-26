import { Quaternion, Vector3 } from 'three';
import type { Frame } from './frame';
import type { Carrier, Placed } from './carrier';
import { solveChain } from './chain';
import { follow, followRotation } from './follow';
import { clampRotation } from './limits';
import { exp, log } from './rotation';
import { live, REACHED, type Live, type Motion, type Placement, type Target } from './goal';
import type { ReadonlyPose } from './pose';
import { TrackedRotation } from './track';

/** How a chain's tip goes to its target. */
export interface TipOptions extends Motion {
  /** where a two-segment chain's middle joint bends toward (world) */
  pole?: Live<Vector3>;
  /** the target is on this carrier, in its frame: the tip goes with it */
  on?: Carrier;
  /**
   * a tip further out than all but the chain's full length as this sets off (an arm hanging all but
   * straight) is not drawn in at once: it is let out as far as it was, never further, until it comes in
   */
  letOut?: boolean;
  /** Follow a contact from the actual pose, without extrapolating the IK goals back into its carrier. */
  contact?: boolean;
  /** after each solve, and again once its joints are braked (`braked`: where they have left the tip): puts the chain out of what it
   * may not pass through (its own body), the tip going to `tip` (world), re-solving it as it must; the intended path goes on as it was */
  clear?: (f: Frame, tip: { position: Vector3; quaternion?: Quaternion }, braked: boolean) => void;
}

/**
 * A chain's tip moved toward targets, a sub-step at a time (`to`): the tip moves on from its
 * history (`follow`; a rotation needs `turnAccel`, `followRotation`), out to all but the chain's
 * full length; the chain is solved to it (`solveChain`); and, with `turnAccel`, every joint of the
 * chain is braked to it: each follows what the solve gives it, a joint the solve swivels faster than
 * `turnSpeed` braked, and stops at the end of its range. Its intended path continues while no later
 * layer moved the tip after its write; projection into reach and joint lag do not change that
 * path's velocity. After another layer's intervention it sets off from the actual tip. One per
 * behaviour moving the chain (it keeps the joints' goals and the tip's path).
 */
export class ChainTip {
  private readonly joints = new Map<number, TrackedRotation>();
  /** each joint `clear` moved after its brakes last sub-step, and its step then as the brakes are to read it (a rotation vector, its
   * parent's frame), and when */
  private readonly nudged = { steps: new Map<number, Vector3>(), time: NaN };
  /** where it moved the tip the last two sub-steps (world) and when last; on a carrier, where it took the carrier to be then */
  private readonly moved = { before: new Vector3(), last: new Vector3(), placed: new Vector3(), time: NaN, frames: [0, 1].map(() => ({ position: new Vector3(), quaternion: new Quaternion() })) };
  /** how far out from the chain's base it let the tip go last (m) */
  private most = Infinity;
  private on?: Carrier;

  constructor(readonly chain: string) {}

  to(f: Frame, target: Target, options: TipOptions): void {
    const { chain } = this;
    const { skeleton } = f.current;
    const bones = skeleton.chain(chain);
    const tip = bones[bones.length - 1];
    const { on, accel, speed, turnAccel, turnSpeed } = options;
    // Resume the intended path unless another layer changed the last applied pose.
    const { moved } = this;
    const own = !options.contact && this.on === on && Math.abs(f.time - f.dt - moved.time) < 1e-9 && moved.placed.distanceTo(f.prev.position(tip)) < 1e-9;
    this.on = on;
    if (!own) this.joints.clear();
    const placed = on?.at(f.time);
    // (the intended path on a carrier, moved with it from where it was foreseen to be to where it was: one worn by a body still
    // posing was carried on as it moved, its actual placement known only once it has moved)
    if (own && placed) for (const [point, at, then] of [[moved.last, moved.frames[1], placed.prev], [moved.before, moved.frames[0], placed.prev2]] as const) {
      if (at.position.equals(then.position) && at.quaternion.equals(then.quaternion)) continue;
      point.sub(at.position).applyQuaternion(_r.copy(at.quaternion).invert()).applyQuaternion(then.quaternion).add(then.position);
    }
    const prev2 = own ? moved.before : f.prev2.position(tip);
    const prev = own ? moved.last : f.prev.position(tip);
    const position = follow(prev2, prev, target.position, { accel, speed, velocity: target.velocity, on: placed }, f.dt, _position);
    let quaternion: Quaternion | undefined;
    if (target.quaternion) {
      if (turnAccel === undefined) throw new Error(`chain "${chain}": a target rotation needs a turnAccel`);
      const goal = target.axis ? rolled(target.quaternion, target.axis, near(f.prev.rotation(tip), placed)) : target.quaternion;
      quaternion = followRotation(f.prev2.rotation(tip), f.prev.rotation(tip), goal, { accel: turnAccel, speed: turnSpeed, velocity: target.spin, on: placed }, f.dt, _quaternion);
    }
    moved.before.copy(own ? moved.last : f.prev.position(tip));
    moved.last.copy(position);
    moved.time = f.time;
    if (placed) for (const [k, at] of [placed.prev, placed.current].entries()) {
      moved.frames[k].position.copy(at.position);
      moved.frames[k].quaternion.copy(at.quaternion);
    }
    // (no further than all but the chain's full length: a chain pulled straight swivels on any wobble)
    const base = f.current.position(bones[0]);
    let length = 0;
    for (let k = 1; k < bones.length; k++) length += skeleton.bones[bones[k]].offset.length();
    const was = f.prev.position(tip).distanceTo(f.prev.position(bones[0]));
    const most = (this.most = options.letOut ? Math.max(REACH * length, Math.min(length, was, own ? this.most : Infinity)) : REACH * length);
    const out = position.distanceTo(base);
    if (out > most) position.sub(base).multiplyScalar(most / out).add(base);
    solveChain(f, chain, { tip: { position, quaternion }, pole: options.pole === undefined ? undefined : live(options.pole, f) });
    options.clear?.(f, { position, quaternion }, false);
    if (turnAccel !== undefined) {
      const nudged = own && Math.abs(f.time - f.dt - this.nudged.time) < 1e-9 ? this.nudged.steps : null;
      for (const b of bones) {
        const pace = { accel: turnAccel, speed: turnSpeed };
        // (a joint nudged last sub-step moved on as `clear` left its step, from where it was put)
        const step = nudged?.get(b);
        const before = step ? exp(-step.x, -step.y, -step.z, _before).multiply(f.prev.local(b)) : f.prev2.local(b);
        const q = options.contact
          ? followRotation(before, f.prev.local(b), f.current.local(b), pace, f.dt, _joint)
          : this.joint(b).follow(before, f.prev.local(b), f.current.local(b), pace, f.dt, _joint);
        // (carried on by its motion, a joint stops at the end of its range)
        const limit = skeleton.limits[b];
        if (limit) clampRotation(q, limit);
        f.current.setLocal(b, q);
      }
    }
    // Joint damping must not separate an acquired contact: re-solved to it (and to its rotation, if it has one) from the damped
    // bend. A grip without a rotation leaves the damped wrist free: pinned, a folded arm would swivel round to keep it. The bend
    // kept as the brakes left it, the limits clamped there: a grip the wrist turns just past its range would otherwise swivel the
    // elbow round in one sub-step (thousands of °/s), the brakes' work undone; the brakes carry it round toward the solve instead.
    const off = f.current.position(tip).distanceTo(position) > 1e-6 || (quaternion !== undefined && f.current.rotation(tip).angleTo(quaternion) > 1e-6);
    if (options.contact && off) solveChain(f, chain, { tip: { position, quaternion }, pole: f.current.position(bones[1]).clone(), swivel: false });
    this.nudged.steps.clear();
    if (options.clear && turnAccel !== undefined) {
      const braked = bones.map((b) => f.current.local(b).clone());
      options.clear(f, { position: _braked.copy(f.current.position(tip)), quaternion: _turned.copy(f.current.rotation(tip)) }, true);
      // (a joint nudged was put there, not swung: the brakes read it as going on as they had it go — the nudge read as its motion,
      // they would carry it on at the nudge's speed, far beyond what they stop soon, flinging the limb on)
      bones.forEach((b, k) => {
        if (f.current.local(b).angleTo(braked[k]) < 1e-9) return;
        this.nudged.steps.set(b, log(braked[k].multiply(_r.copy(f.prev.local(b)).invert()), new Vector3()));
      });
      this.nudged.time = f.time;
    }
    moved.placed.copy(f.current.position(tip));
  }

  private joint(bone: number): TrackedRotation {
    let joint = this.joints.get(bone);
    if (!joint) this.joints.set(bone, (joint = new TrackedRotation()));
    return joint;
  }
}

/**
 * Bone `tip` of a body (its last poses `prev2`, `prev`, `dt` apart, before the sub-step at `time`) is on `target`: within
 * REACHED's distance and angle, and moving with it to within its speed. The last pose is a sub-step old, so it is judged
 * against where the target was then: on a carrier (in its frame), as the carrier was placed then and the sub-step before
 * (`Carrier.at`); else moved back by its velocity.
 */
export function reached(f: { prev2: ReadonlyPose; prev: ReadonlyPose; dt: number; time: number }, tip: number, target: Target, on?: Carrier): boolean {
  const { prev2, prev, dt } = f;
  const placed = on?.at(f.time);
  const then = _then, velocity = _velocity, moved = target.velocity ?? ZERO;
  if (on && placed) {
    // (the target point as the carrier was placed `back` sub-steps before `time`)
    const was = (back: number, at: Required<Placement>, out: Vector3) => out.copy(target.position).addScaledVector(moved, -back * dt).applyQuaternion(at.quaternion).add(at.position);
    const goal = on.toWorld(target, _goal, f.time);
    then.copy(goal.position).addScaledVector(velocity.copy(moved).applyQuaternion(placed.current.quaternion).add(goal.velocity), -dt);
    velocity.subVectors(was(1, placed.prev, _was), was(2, placed.prev2, _was2)).divideScalar(dt);
  } else {
    velocity.copy(moved);
    then.copy(target.position).addScaledVector(velocity, -dt);
  }
  const at = prev.position(tip);
  const moving = _v.subVectors(at, prev2.position(tip)).divideScalar(dt).sub(velocity);
  if (at.distanceTo(then) > REACHED.distance || moving.length() > REACHED.speed) return false;
  if (!target.quaternion) return true;
  // (in the frame the target is given in, rolled about its axis as near the tip as it may be)
  const turned = near(prev.rotation(tip), placed && { current: placed.prev });
  return (target.axis ? rolled(target.quaternion, target.axis, turned) : target.quaternion).angleTo(turned) <= REACHED.angle;
}

/** a world rotation in the frame a target is given in: on a carrier, its (as placed `current`) */
function near(world: Readonly<Quaternion>, on?: Pick<Placed, 'current'>): Quaternion {
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
const _braked = new Vector3();
const _turned = new Quaternion();
const _before = new Quaternion();
const _quaternion = new Quaternion();
const _joint = new Quaternion();
const _r = new Quaternion();
const _v = new Vector3();
const _axis = new Vector3();
const _d = new Quaternion();
const _roll = new Quaternion();
const _near = new Quaternion();
const _velocity = new Vector3();
const _then = new Vector3();
const _was = new Vector3();
const _was2 = new Vector3();
const _goal: Target & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
