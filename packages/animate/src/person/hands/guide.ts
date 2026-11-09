import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import { MovingFrame } from '../../kernel/moving-frame';
import { type Live, type Motion, type Placement, type Goal } from '../../kernel/goal';
import { follow, PointFollower, RotationFollower } from '../../kernel/follow';
import type { Thing } from '../../things/thing';
import type { Clearance } from '../../things/carry-path';
import { clearBody } from './load-clearance';
import type { Person } from '../person';

// A carried thing's guide: where it is to go each sub-step, followed at a carry's pace about its grips and kept clear of the body.

/** how fast a held thing is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;

/** A carry's one load path, from its first leg through the hold at its end, each leg setting its pace (`paced`): clear its path before
 * following it, and judge the same endpoint. A new one each leg would set out from where the thing was read as the sub-step began, before
 * the arm is solved, and the hand jump back to that as it took over. */
export class Guide {
  readonly goal = { position: new Vector3(), quaternion: new Quaternion() };
  private readonly carrier: MovingFrame;
  private readonly nominal: MovingFrame;
  private readonly position = new PointFollower();
  private readonly rotation = new RotationFollower();
  private readonly at = new Vector3();
  private readonly turned = new Quaternion();
  private time = NaN;
  /** how far (m) the body's own trunk and head held the last goal read off where it was asked to go: its end is that much out of its reach */
  off = 0;
  /** how much of the push clear of the body it has taken up, the two sub-steps before */
  private readonly pushed = [new Vector3(), new Vector3()];

  /** the middle of the grips both its hands hold it by, where the palms close on it (its frame; held in one, its origin) */
  private readonly pivot = new Vector3();
  private motion: Motion;
  clear: Clearance;
  armTurn?: number;

  /** carried at `pace` (as calm as `CARRYING`, or brisker) kept `clearance` clear of the body, unless a leg says otherwise */
  constructor(private readonly person: Person, private readonly thing: Thing, private readonly pace: Motion, private readonly clearance: Clearance) {
    [this.motion, this.clear] = [pace, clearance];
    const own = person.movingFrameOf(thing.object);
    this.nominal = new MovingFrame(own.current.position, own.current.quaternion);
    this.carrier = new MovingFrame(own.current.position, own.current.quaternion);
    this.nominal.prev.position.copy(own.prev.position);
    this.nominal.prev.quaternion.copy(own.prev.quaternion);
  }

  /** this leg's pace — its acceleration `factor` times slower, for a load — and clearance, about the grips that hold it now */
  paced(factor = 1, clear = this.clearance, armTurn?: number): this {
    [this.motion, this.clear, this.armTurn] = [{ ...this.pace, accel: this.pace.accel / factor }, clear, armTurn];
    const { person, thing, pivot } = this, grips = Object.values(person.holding).flatMap((hold) => hold?.thing === thing ? [thing.grip(hold.grip).at.position] : []);
    pivot.set(0, 0, 0);
    // (held in both hands; one hand's thing goes where its path has it, the hand with it)
    if (grips.length > 1) for (const grip of grips) pivot.addScaledVector(grip, 1 / grips.length);
    return this;
  }

  read(f: Frame, to: Live<Goal>): MovingFrame {
    if (this.time === f.time) return this.carrier;
    this.time = f.time;
    const { nominal, goal, person, thing, motion } = this;
    // (its track read where it stands as the sub-step begins, before the hands move it: what tells when it has come to rest)
    person.movingFrameOf(thing.object);
    // (kept clear as it is turned on its way, not as its hand has it: a hand short of its turn would feed back into the guide, pushing it
    // on ahead, the arm stretching after it and the turn falling shorter still)
    const current = nominal.current;
    const target: Goal = typeof to === 'function' ? to(f) : to;
    this.carrier.carriedBy = target.carriedBy;
    goal.position.copy(target.position);
    // (a goal that sets no turn keeps the one the guide set out with: the thing's own turn, a hand's lag in it, is not fed back)
    goal.quaternion.copy(target.quaternion ?? this.nominal.current.quaternion);
    // Continue the intended motion, rather than feeding wrist-fitting lag back into it.
    // (a goal its own body carries is followed in its motion however fast the body moves and turns it, never braked to as a jump)
    const own = target.carriedBy === person;
    const turned = this.rotation.follow(nominal.prev.quaternion, nominal.current.quaternion, goal.quaternion,
      { accel: motion.turnAccel ?? CARRYING.turnAccel, speed: motion.turnSpeed }, f.dt, this.turned, own ? Infinity : undefined);
    // (a goal in the neck or head — a cup put to the mouth — is carried clear of them in front)
    if (this.clear) clearBody(person, f, thing, goal.position, turned, current, this.clear !== 'head', this.clear === 'parts');
    this.off = goal.position.distanceTo(target.position);
    // (followed about the middle of its grips, where the hands are: turning, a thing held off its middle lags about them, not about its
    // own origin, and does not swing off them)
    const pivot = this.pivot, held = (at: Placement, turn: Quaternion, out: Vector3) => out.copy(pivot).applyQuaternion(turn).add(at.position);
    this.position.follow(held(nominal.prev, nominal.prev.quaternion, _p1), held(nominal.current, nominal.current.quaternion, _p2), held(goal, goal.quaternion, _p3), motion, f.dt, this.at,
      own ? Infinity : undefined);
    this.at.sub(_p1.copy(pivot).applyQuaternion(turned));
    // Constraint correction is not velocity to feed back into the intended path.
    nominal.move(f.time, this.at, turned);
    const aimed = _aimed.copy(this.at);
    if (this.clear) clearBody(person, f, thing, this.at, turned, current, this.clear !== 'head', this.clear === 'parts');
    // (the push clear of the body is taken up at the guide's own pace, not snapped: a thing set out from against the body — taken there —
    // is drawn off it, and one that comes up against it on its way — a box lifted close in front of a bowed body — eases round it)
    const [prev2, prev] = this.pushed;
    const pushed = follow(prev2, prev, _push.subVectors(this.at, aimed), motion, f.dt, _pushed);
    prev2.copy(prev);
    prev.copy(pushed);
    this.carrier.move(f.time, this.at.copy(aimed).add(pushed), turned);
    return this.carrier;
  }
}
const _aimed = new Vector3(), _push = new Vector3(), _pushed = new Vector3();
const _p1 = new Vector3(), _p2 = new Vector3(), _p3 = new Vector3();
