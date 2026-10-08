import { Quaternion, Vector3 } from 'three';
import type { Proportions } from '../proportions';
import type { Gait } from '../gait/gait';
import { positionOf, quaternionOf, weightOf, type Target } from '../input';
import { clamp, forwardOf, hypot, minimumJerk, wrapAngle, yawOf, yawOfQuaternion } from '../math';
import type { SeatTask, Task } from './tasks';

/** time to sit down / stand up (s, minimum-jerk profile) */
const SIT_TIME = 1.4;
const STAND_TIME = 1.2;
/** riding, up off the saddle or down onto it (s): no chair to lower onto or push up from */
const SADDLE_TIME = 0.5;

const _q = new Quaternion();
const _up = new Vector3();

/**
 * The sit/stand sequence: walk up to the spot in front of the seat, turn the back to it,
 * sit down; when the seat is gone, stand up again (held until back up on the feet).
 */
export class Seat {
  /** how far down, 0 (standing) → 1 (seated), eased and scaled by the seat's weight */
  sit = 0;
  /** the sequence owns where the body stands (from approach until it is up again) */
  ownsGoal = false;
  /** a seat is given */
  private on = false;
  /** seated progress 0 → 1 along time */
  private u = 0;
  private weight = 1;
  private pos = new Vector3();
  private yaw = 0;
  /** how far the seat's back leans back (rad; from its rotation's pitch) */
  private recline = 0;
  /** where the support centre stands: feet a little behind the knees, ready to take the weight again */
  private stand = new Vector3();
  private task: SeatTask = { pos: new Vector3(), weight: 0, recline: 0 };

  constructor(private d: Proportions) {}

  /** the sequence keeps the body where it is: sitting, seated, or getting back up */
  get holdsBody() {
    return this.u > 0 || (this.ownsGoal && !this.on);
  }

  read(e: Target | undefined, root: { x: number; z: number }, drop: number) {
    const d = this.d;
    const wasOn = this.on;
    const weight = weightOf(e);
    this.on = weight > 0 && !!positionOf(e, this.pos);
    if (this.on) {
      this.weight = weight;
      const facing = quaternionOf(e, _q);
      if (facing) this.yaw = yawOfQuaternion(facing);
      // default facing: away from where the body comes from
      else if (!wasOn && this.u === 0) this.yaw = yawOf(root.x - this.pos.x, root.z - this.pos.z);
      // (the seat's up tilted back: a backrest)
      const up = facing ? _up.set(0, 1, 0).applyQuaternion(facing) : null;
      this.recline = up ? Math.max(0, Math.atan2(-(up.x * Math.sin(this.yaw) + up.z * Math.cos(this.yaw)), up.y)) : 0;
      forwardOf(this.yaw, this.stand)
        .multiplyScalar(0.33 * d.scale)
        .add(this.pos);
    }
    this.ownsGoal = this.on || this.u > 0 || (this.ownsGoal && drop > 0.04 * d.height);
  }

  /** the standing spot while the sequence holds it (the gait walks up facing the way it goes and turns on arrival) */
  goalTask(out: Task & { yaw: number | null }) {
    out.pos.copy(this.stand);
    out.weight = 1;
    out.yaw = this.yaw;
    return out;
  }

  /** where the hip joints rest while (partly) seated */
  seatTask(): SeatTask | null {
    if (this.sit <= 0) return null;
    const out = this.task;
    out.recline = this.recline;
    // (posting, up off it and forward)
    out.pos.copy(this.pos).setY(this.pos.y + 0.085 * this.d.scale + this.post);
    forwardOf(this.yaw, _up).multiplyScalar(0.5 * this.post);
    out.pos.add(_up);
    out.weight = this.sit;
    return out;
  }

  /** how far a rider rises out of it, posting (m) */
  private post = 0;

  /** sit down once standing in front of the seat, facing away (mounted: at once, a saddle); stand up when it's gone */
  update(dt: number, g: Gait) {
    const arrived =
      hypot(g.root.x - this.stand.x, g.root.z - this.stand.z) < 0.08 &&
      Math.abs(wrapAngle(g.root.yaw - this.yaw)) < 0.25 &&
      g.speed < 0.15 &&
      g.feet[0].phase === 'planted' &&
      g.feet[1].phase === 'planted';
    const down = this.on && (this.u > 0 || arrived || g.mount.owns);
    this.post = g.mount.owns ? g.mount.post : 0;
    const time = g.mount.owns ? SADDLE_TIME : down ? SIT_TIME : STAND_TIME;
    this.u = clamp(this.u + (down ? dt : -dt) / time, 0, 1);
    this.sit = minimumJerk(this.u) * this.weight;
  }
}
