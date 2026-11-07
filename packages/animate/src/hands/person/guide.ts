import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../../kernel/frame';
import { Carrier } from '../../kernel/carrier';
import { type Live, type Motion, type Placement, type Goal } from '../../kernel/goal';
import { TrackedPoint, TrackedRotation } from '../../kernel/track';
import { follow } from '../../kernel/follow';
import type { Thing } from '../../things/thing';
import type { Reacher } from './reacher';
import type { Clearance } from '../route';
import { clearBody } from './clearance';

// A carried thing's guide: where it is to go each sub-step, followed at a carry's pace about its grips and kept clear of the body.

/** how fast a held thing is carried where it is to go (m/s², m/s, rad/s², rad/s): calmly */
export const CARRYING = { accel: 6, speed: 3, turnAccel: 8, turnSpeed: 4 } satisfies Motion;
/** Tuned: a held goal moved further than this (m, × the body's scale) to clear the neck and head is noted */
const CLEARED = 0.02;

export type Guides = (factor?: number, clearance?: Clearance) => Guide;

export function guidesFor(person: Reacher, thing: Thing, motion: Motion, clear: Clearance): Guides {
  return (factor = 1, clearance = clear) => new Guide(person, thing, { ...motion, accel: motion.accel / factor }, clearance);
}

/** One load path: clear its course before following it, and judge the same endpoint. */
export class Guide {
  readonly goal = { position: new Vector3(), quaternion: new Quaternion() };
  private readonly carrier: Carrier;
  private readonly nominal: Carrier;
  private readonly position = new TrackedPoint();
  private readonly rotation = new TrackedRotation();
  private readonly at = new Vector3();
  private readonly turned = new Quaternion();
  private time = NaN;
  /** whether a goal moved clear of the head has been noted */
  private cleared = false;
  /** how far (m) the body's own trunk and head held the last goal read off where it was asked to go: none for a goal on its own head
   * (a cup put to the mouth stops in front of it by design), else the body stands in the way of its end */
  off = 0;
  /** how much of the push clear of the body it has taken up, the two sub-steps before */
  private readonly pushed = [new Vector3(), new Vector3()];

  /** the middle of the grips both its hands hold it by, where the palms close on it (its frame; held in one, its origin) */
  private readonly pivot = new Vector3();


  constructor(private readonly person: Reacher, private readonly thing: Thing, private readonly motion: Motion, private readonly clear: Clearance) {
    const own = person.track(thing.object);
    const grips = Object.values(person.holding).flatMap((hold) => hold?.thing === thing ? [thing.grip(hold.grip).at.position] : []);
    // (held in both hands; one hand's thing goes where its course has it, the hand with it)
    if (grips.length > 1) for (const grip of grips) this.pivot.addScaledVector(grip, 1 / grips.length);
    this.nominal = new Carrier(own.current.position, own.current.quaternion);
    this.carrier = new Carrier(own.current.position, own.current.quaternion);
    this.nominal.prev.position.copy(own.prev.position);
    this.nominal.prev.quaternion.copy(own.prev.quaternion);
  }

  read(f: Frame, to: Live<Goal>): Carrier {
    if (this.time === f.time) return this.carrier;
    this.time = f.time;
    const { nominal, goal, person, thing, motion } = this;
    // (its track read where it stands as the sub-step begins, before the hands move it: what tells when it has come to rest)
    person.track(thing.object);
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
    // (a goal in the neck or head — a cup put to the mouth — is carried clear of them in front: noted once, so it is no silent change)
    const moved = this.clear ? clearBody(person, f, thing, goal.position, turned, current, this.clear !== 'head', this.clear === 'parts') : 0;
    this.off = this.clear === 'head' ? 0 : goal.position.distanceTo(target.position);
    if (moved > CLEARED * person.scale && !this.cleared && f.dev) {
      this.cleared = true;
      f.dev.note(f.time, { check: 'held goal moved clear of the head (m)', value: moved, limit: CLEARED * person.scale, where: thing.object.name });
    }
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
