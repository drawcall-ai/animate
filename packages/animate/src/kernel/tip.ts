import type { Miss } from './requests';
import { Quaternion, Vector3 } from 'three';
import type { Frame } from './frame';
import type { Carrier } from './carrier';
import { solveChain } from './chain';
import { follow, followRotation } from './follow';
import { limited } from './limits';
import { exp, log } from './rotation';
import { REACHED, type Motion, type Trail, type Placement, type Goal } from './goal';
import type { ReadonlyPose } from './pose';
import { TrackedRotation } from './track';
import { forwardOf, leftOf } from './math';

/** How a chain's tip goes to its target. */
interface TipOptions extends Motion {
  /** where a two-segment chain's middle joint bends toward (world) */
  pole?: Vector3;
  /** the target is on this carrier, in its frame: the tip goes with it */
  on?: Carrier;
  /** a tip further out than all but the chain's full length as this sets off (an arm hanging all but straight) is not drawn in at once:
   * it is let out as far as it was, never further, until it comes in */
  letOut?: boolean;
  /** a two-segment chain that cannot fit its goal on the pole's side keeps the swivel and middle-bone twist it has, unless another fit
   * is clearly better (a hand holding something: the arm as it holds it, not chosen afresh as the goal moves on) */
  keep?: boolean;
  /** Follow a contact from the actual pose, without extrapolating the IK goals back into its carrier. */
  contact?: boolean;
  /** after each solve, and again once its joints are braked (`braked`: where they have left the tip): puts the chain out of what it may
   * not pass through (its own body), the tip going to `tip` (world), re-solving it as it must; the intended path goes on as it was */
  clear?: (f: Frame, tip: { position: Vector3; quaternion?: Quaternion }, braked: boolean) => void;
}

/** Follow a tip path, solve the chain, then brake its joints within limits. Projection and joint lag preserve intended velocity; another layer moving the tip restarts from the actual pose.
 * Keep one ChainTip per behaviour: it owns the joint goals and path history. */
export class ChainTip {
  private readonly joints = new Map<number, TrackedRotation>();
  /** each joint contact or clearance moved after its brakes in its last call, and its step then as the brakes are to read it (a rotation vector, its
   * parent's frame) */
  private readonly nudged = new Map<number, Vector3>();
  /** where it moved and turned the tip the last two sub-steps (world), where it left it, and when last; on a carrier, where it took the
   * carrier to be then */
  private readonly moved = { before: new Vector3(), last: new Vector3(), turnedBefore: new Quaternion(), turned: new Quaternion(), placed: new Vector3(),
    placedTurn: new Quaternion(), time: NaN, frames: [0, 1].map(() => ({ position: new Vector3(), quaternion: new Quaternion() })) };
  /** the chain's joints as its last solve left them, before the brakes */
  private solved: Quaternion[] = [];
  /** whether its last call turned the tip along an intended turn it runs on (`moved.turned`): its fit kept (`keep`), or its turn only
   * preferred — resumed only by a call that runs one on too */
  private resumes = false;
  /** how far out from the chain's base it let the tip go last (m) */
  private most = Infinity;
  private on?: Carrier;

  constructor(readonly chain: string) {}

  to(f: Frame, target: Goal, options: TipOptions): void {
    const { chain } = this, { skeleton } = f.current;
    const bones = skeleton.chain(chain);
    const tip = bones[bones.length - 1];
    const { on, accel, speed, turnAccel, turnSpeed } = options;
    // Resume the intended path unless another layer changed the last applied pose.
    const { moved } = this;
    const continued = this.on === on && Math.abs(f.time - f.dt - moved.time) < 1e-9 && moved.placed.distanceTo(f.prev.position(tip)) < 1e-9;
    const own = !options.contact && continued;
    this.on = on;
    if (!own) this.joints.clear();
    const placed = on?.at(f.time);
    // (the intended path on a carrier, moved with it from where it was foreseen to be to where it was: one worn by a body still posing
    // was carried on as it moved, its actual placement known only once it has moved)
    if (own && placed) for (const [point, turn, at, then] of [[moved.last, moved.turned, moved.frames[1], placed.prev], [moved.before, moved.turnedBefore, moved.frames[0], placed.prev2]] as const) {
      if (at.position.equals(then.position) && at.quaternion.equals(then.quaternion)) continue;
      point.sub(at.position).applyQuaternion(_r.copy(at.quaternion).invert()).applyQuaternion(then.quaternion).add(then.position);
      turn.premultiply(_r).premultiply(then.quaternion);
    }
    const prev2 = own ? moved.before : f.prev2.position(tip);
    const prev = own ? moved.last : f.prev.position(tip);
    const position = follow(prev2, prev, target.position, { accel, speed, velocity: target.velocity, on: placed }, f.dt, _position);
    let quaternion: Quaternion | undefined;
    if (target.quaternion) {
      if (turnAccel === undefined) throw new Error(`chain "${chain}": a target rotation needs a turnAccel`);
      // (a fit kept (`keep`) turns on along its intended turn, as the tip's position path does, while the tip is turned as it was left:
      // read back from the tip as the limits and brakes left it, a hand held short of its turn was asked only a sub-step's turn on from
      // there each time, never enough for the fit to give way (`HELD`, chain.ts) to one that turns it there — a bucket by its handle set
      // down stuck 2.3 rad short, turned half round — and one braked behind its turn was asked on at the pace the brakes left it: the
      // ask overshot, the brakes lagged it again, and a knot in the hand swung 3 cm about its end for a second. A fit chosen afresh (a
      // reach) turns on from the tip as its joints left it: an intended turn run on ahead of a reach the brakes hold back had the arm
      // solved into the trunk. A turn only preferred runs on too: it is the last joint's alone, never swivelling the arm for it, and read
      // back from a hand its wrist holds short, the hand's motion along the wrist's range ran the ask round its turn at 5 rad/s, never
      // nearer — a hand at a rifle's foregrip spun on, 157° off its turn. 1 − |dot|, not `angleTo`, for "as it was left": acos loses
      // the precision near zero, ~1e-8 rad.)
      const resumed = own && this.resumes && (options.keep === true || target.preferred === true) && 1 - Math.abs(moved.placedTurn.dot(f.prev.rotation(tip))) < 1e-12;
      const before = resumed ? moved.turnedBefore : f.prev2.rotation(tip), last = resumed ? moved.turned : f.prev.rotation(tip);
      quaternion = followRotation(before, last, target.quaternion, { accel: turnAccel, speed: turnSpeed, velocity: target.spin, on: placed }, f.dt, _quaternion);
      moved.turnedBefore.copy(last);
      moved.turned.copy(quaternion);
    }
    moved.before.copy(prev);
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
    // (a fit kept is the last solve's, as production IK seeds a pole-vector solve from the last frame: seeded from the arm as its brakes
    // left it, between the fit asked and the one before, the solve could settle into another — a belt's tongue held at its end swung 4 cm
    // off it as the other hand's carry ended. Unless what it may not pass through held the arm off it after its brakes (`nudged`): then the fit is the
    // arm's as it was left — the last solve's, kept on the trunk's far side, was braked toward and pushed back out each sub-step, a ball
    // regripped in the hand left 70° off its turn for good)
    if (own && options.keep && this.solved.length === bones.length && !this.nudged.size) bones.forEach((b, k) => f.current.setLocal(b, this.solved[k]));
    // (a turn only preferred is the tip's own, as far as its last joint turns it: the bend is not swivelled off the pole's plane for it)
    solveChain(f, chain, { tip: { position, quaternion }, pole: options.pole, keep: options.keep, poleFirst: target.preferred });
    this.solved = bones.map((b, k) => (this.solved[k] ?? new Quaternion()).copy(f.current.local(b)));
    this.resumes = (options.keep === true || target.preferred === true) && quaternion !== undefined;
    options.clear?.(f, { position, quaternion }, false);
    if (turnAccel !== undefined) {
      const nudged = continued ? this.nudged : null;
      for (const b of bones) {
        const pace = { accel: turnAccel, speed: turnSpeed };
        // (a corrected joint continues its braked velocity from where contact or clearance put it)
        const step = nudged?.get(b);
        const before = step ? exp(-step.x, -step.y, -step.z, _before).multiply(f.prev.local(b)) : f.prev2.local(b);
        const joint = this.joints.get(b) ?? new TrackedRotation();
        this.joints.set(b, joint);
        const q = options.contact
          ? followRotation(before, f.prev.local(b), f.current.local(b), pace, f.dt, _joint)
          : joint.follow(before, f.prev.local(b), f.current.local(b), pace, f.dt, _joint);
        // (carried on by its motion, a joint stops at the end of its range)
        f.current.setLocal(b, limited(skeleton, b, q));
      }
    }
    // Joint damping must not separate an acquired contact: re-solved to it (and to its rotation, if it has one) from the damped bend.
    // A grip without a rotation leaves the damped wrist free: pinned, a folded arm would swivel round to keep it. The bend kept as the
    // brakes left it, the limits clamped there: a grip the wrist turns just past its range would otherwise swivel the elbow round in
    // one sub-step (thousands of °/s), the brakes' work undone; the brakes carry it round toward the solve instead.
    const braked = turnAccel !== undefined && (options.contact || options.clear) ? bones.map((b) => f.current.local(b).clone()) : null;
    const off = f.current.position(tip).distanceTo(position) > 1e-6 || (quaternion !== undefined && f.current.rotation(tip).angleTo(quaternion) > 1e-6);
    if (options.contact && off) solveChain(f, chain, { tip: { position, quaternion }, pole: f.current.position(bones[1]).clone(), swivel: false });
    this.nudged.clear();
    if (options.clear && turnAccel !== undefined) {
      options.clear(f, { position: _braked.copy(f.current.position(tip)), quaternion: quaternion && _turned.copy(f.current.rotation(tip)) }, true);
    }
    if (braked) {
      // (a joint nudged was put there, not swung: the brakes read it as going on as they had it go — the nudge read as its motion,
      // they would carry it on at the nudge's speed, far beyond what they stop soon, flinging the limb on)
      bones.forEach((b, k) => {
        // acos(dot) loses precision near zero and can classify an unchanged rotation as a correction.
        if (log(_r.copy(braked[k]).invert().premultiply(f.current.local(b)), _v).length() < 1e-9) return;
        this.nudged.set(b, log(braked[k].multiply(_r.copy(f.prev.local(b)).invert()), new Vector3()));
      });
    }
    moved.placed.copy(f.current.position(tip));
    moved.placedTurn.copy(f.current.rotation(tip));
  }
}

type TipPose = Pick<ReadonlyPose, 'position' | 'rotation'>;

/** Judge the last final pose against the target one sub-step ago: carrier history or velocity extrapolation, within REACHED distance, angle and relative `speed`
 * (a verb cut short by `until`, on its goal as that comes, needs none: `Infinity`); a turn only preferred, within REACHED angle or no longer turning (`TURNING`). */
export function reached(f: { prev2: TipPose; prev: TipPose; dt: number; time: number }, tip: number, target: Goal, on?: Carrier, speed = REACHED.speed): boolean {
  const { prev2, prev, dt } = f;
  const placed = on?.at(f.time);
  const then = _then, velocity = _velocity, moved = target.velocity ?? ZERO;
  if (on && placed) {
    // (the target point as the carrier was placed `back` sub-steps before `time`)
    const was = (back: number, at: Placement, out: Vector3) => out.copy(target.position).addScaledVector(moved, -back * dt).applyQuaternion(at.quaternion).add(at.position);
    const goal = on.toWorld(target, _goal, f.time);
    then.copy(goal.position).addScaledVector(velocity.copy(moved).applyQuaternion(placed.current.quaternion).add(goal.velocity), -dt);
    velocity.subVectors(was(1, placed.prev, _was), was(2, placed.prev2, _was2)).divideScalar(dt);
  } else {
    velocity.copy(moved);
    then.copy(target.position).addScaledVector(velocity, -dt);
  }
  const at = prev.position(tip);
  const moving = _v.subVectors(at, prev2.position(tip)).divideScalar(dt).sub(velocity);
  if (at.distanceTo(then) > REACHED.distance || moving.length() > speed) return false;
  const angle = angleOff(f, tip, target, on);
  return angle <= REACHED.angle || (target.preferred === true && turning(f, tip, placed) <= TURNING);
}

/** how fast (rad/s) a tip short of a turn only preferred may still turn, in the frame its target is in, and be as far as it goes: a grasp
 * closed on a hand still turning would be shaped for a turn the hand goes on from. The tip's own turning, not how fast it comes nearer the
 * turn: a hand swinging back off its turn, still turning, comes no nearer for a moment at the swing's end (one taken so, 32° short of it,
 * came to rest 2° short), and one taken as it swung back came to rest further off than the fingers had closed for. (A swing reversing
 * about one axis alone still passes through rest for a sub-step.) */
const TURNING = 0.2;

/** how fast `tip` turns (rad/s) in the frame of `placed` (else the world's), as the last two final poses have it */
function turning(f: { prev2: TipPose; prev: TipPose; dt: number }, tip: number, placed?: Trail): number {
  const was = _turnedBefore.copy(near(f.prev2.rotation(tip), placed && { current: placed.prev2 }));
  return near(f.prev.rotation(tip), placed && { current: placed.prev }).angleTo(was) / f.dt;
}

/** whether a tip stopped this near a goal is there: as near as a verb's verdict on it counts, moving or not (`reached` also asks it be still and nearer) */
export function closeTo(f: Frame, tip: number, target: Goal, on?: Carrier): boolean {
  const off = unmet(f, tip, target, on);
  return off.distance <= REACHED.close && off.angle <= REACHED.angle;
}

/** The unmet turn, in radians, as the last final pose has it. */
function angleOff(f: { prev: Pick<ReadonlyPose, 'rotation'>; time: number }, tip: number, target: Goal, on?: Carrier): number {
  if (!target.quaternion) return 0;
  const placed = on?.at(f.time);
  // (in the frame the target is given in)
  return target.quaternion.angleTo(near(f.prev.rotation(tip), placed && { current: placed.prev }));
}

/** how far a tip is from its target as the last final pose has it: its distance (m) and the turn left (rad; none of a turn only
 * preferred: it goes as far as it may), the target's world point */
export function unmet(f: Frame, tip: number, target: Goal, on?: Carrier): { distance: number; angle: number; at: Vector3 } {
  const at = on ? on.toWorld(target, _goal, f.time).position : target.position;
  return { distance: f.prev.position(tip).distanceTo(at), angle: target.preferred ? 0 : angleOff(f, tip, target, on), at: _late.copy(at) };
}

/**
 * Whether a tip has stopped getting nearer its goal: its miss (`unmet`) no smaller by `STOPPED.closer` (m, rad) for `STOPPED.seconds`, as
 * the last final poses have it — a hand held off its target, not one still on its way, however its turn or its goal wavers there. Read
 * once a sub-step.
 */
export class Progress {
  private best = { distance: Infinity, angle: Infinity };
  private since = NaN;

  stopped(f: Pick<Frame, 'time'>, off: { distance: number; angle: number }): boolean {
    const closer = off.distance < this.best.distance - STOPPED.closer || off.angle < this.best.angle - STOPPED.turned;
    if (Number.isNaN(this.since) || closer) [this.best, this.since] = [{ distance: off.distance, angle: off.angle }, f.time];
    return f.time - this.since > STOPPED.seconds;
  }

  /** watched afresh from the next sub-step on (the body stepping under the hand: not the hand's own lack of progress) */
  reset(): void {
    this.since = NaN;
  }
}

/** how much nearer (m) and less turned off (rad) a tip must come to be still closing on its goal, and for how long it may not (s) */
const STOPPED = { closer: 0.003, turned: 0.02, seconds: 0.5 };

/**
 * A late reach's miss, if position or turn is unmet (position first, never a zero distance for a blocked turn): where the tip stopped in the
 * body's frame and, if `cause` says, what held it there.
 */
export function lateReach(f: Frame, tip: number, target: Goal, where: string, on?: Carrier, cause?: (at: Vector3) => string | undefined): Miss | null {
  const { distance, angle, at } = unmet(f, tip, target, on);
  const why = cause?.(at), held = why ? `: ${why}` : '';
  const off = _off.subVectors(f.prev.position(tip), at), facing = f.prev.facing;
  const ahead = off.dot(forwardOf(facing, _axis)), left = off.dot(leftOf(facing, _axis)), cm = (m: number) => (100 * Math.abs(m)).toFixed(1);
  const offset = `${cm(ahead)} cm ${ahead >= 0 ? 'ahead of' : 'behind'}, ${cm(left)} cm ${left >= 0 ? 'left of' : 'right of'}, ` +
    `${cm(off.y)} cm ${off.y >= 0 ? 'above' : 'below'} it in the body's frame`;
  if (distance > REACHED.close) return { where, off: distance, limit: REACHED.close, why: `stopped ${cm(distance)} cm off it (${offset})${held}` };
  if (angle > REACHED.angle) return { where, off: angle, limit: REACHED.angle, why: `stopped turned ${(angle * 180 / Math.PI).toFixed(1)}° off it${held}: change the grip's roll or the target's turn` };
  return null;
}

/** a world rotation in the frame a target is given in: on a carrier, its (as placed `current`) */
function near(world: Readonly<Quaternion>, on?: Pick<Trail, 'current'>): Quaternion {
  return on ? _near.copy(on.current.quaternion).invert().multiply(world) : _near.copy(world);
}

/** the share of a chain's length its tip is moved out to at most: as far as a limb reaches, all but straight */
export const REACH = 0.98;
const ZERO = new Vector3(), _turnedBefore = new Quaternion();
const [_position, _braked, _v, _axis, _velocity, _then, _was, _was2, _late, _off] = Array.from({ length: 10 }, () => new Vector3());
const [_turned, _before, _quaternion, _joint, _r, _near] = Array.from({ length: 6 }, () => new Quaternion());
const _goal: Goal & { velocity: Vector3; spin: Vector3 } = { position: new Vector3(), velocity: new Vector3(), spin: new Vector3() };
