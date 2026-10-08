import { Quaternion, Vector3 } from 'three';
import type { Gait, Steer } from '../gait/gait';
import { isSphere, orientedTask, pointOf, positionOf, positionTask, quaternionOf, weightOf, type Box, type Input, type Sphere } from '../input';
import { clamp, GRAVITY, hypot, smoothstep, wrapAngle, yawOf, yawOfQuaternion, type Vec3 } from '../math';
import type { Proportions } from '../proportions';
import { Reach } from './reach';
import { Seat } from './seat';
import { emptyTasks, ownedTask, tracksBody, type FootTask, type GoalTask, type HandTask, type MountTask, type Task, type Tasks } from './tasks';
import { Tracker } from './tracker';

/** no obstacles given */
const NONE: readonly never[] = [];

const handTask = (): HandTask => ({ pos: new Vector3(), rot: null, weight: 0 });

/** tracked bodies may be followed at up to this speed (m/s) */
const TRACKED_SPEED = 2.2;
/** how far ahead (s of travel) a box obstacle is seen coming: the body ducks under a ceiling in time */
const LOOKAHEAD = 0.9;
/** the room kept under a box (× height): the gait's bob doesn't reach it */
const HEADROOM = 0.015;

/**
 * Reads the sparse input into tasks — what is asked, and the hand targets the body acts
 * on now (only once ready to reach) — and into how the walk is steered.
 */
export class Intent {
  readonly tasks: Tasks = emptyTasks();
  readonly steer: Steer = { faceTravel: 1, crouched: false, eager: false, maxSpeed: 0, pace: 1, floorObstacles: [], ground: [], ladders: [], lean: new Vector3(), handsBusy: false };
  readonly tracker = new Tracker();
  readonly seat: Seat;
  /** anything asked of the body at all (otherwise it just stands) */
  active = false;
  private reach: [Reach, Reach];
  // what the tasks are written into, tick after tick
  private headTask: Task = { pos: new Vector3(), weight: 0 };
  private handTasks: [HandTask, HandTask] = [handTask(), handTask()];
  private handRot = [new Quaternion(), new Quaternion()];
  private footTasks: [FootTask, FootTask] = [handTask(), handTask()];
  private footRot = [new Quaternion(), new Quaternion()];
  private mountTask: MountTask = { pos: new Vector3(), rot: null, lean: 1, weight: 1, feet: [null, null] };
  private mountRot = new Quaternion();
  private chestTask = ownedTask();
  private hipsTask = ownedTask();
  private goalTask: GoalTask = { pos: new Vector3(), weight: 0, yaw: null };
  private goalRot = new Quaternion();
  private obstacles: (Sphere | Box)[] = [];
  private boxes: Box[] = [];

  constructor(
    private d: Proportions,
    /** self-paced walking speed (m/s) */
    private maxSpeed: number,
    private gait: Gait,
    /** upper-arm joints [left, right] */
    shoulders: readonly [Vector3, Vector3],
  ) {
    this.seat = new Seat(d);
    this.reach = [new Reach(d, gait, shoulders[0]), new Reach(d, gait, shoulders[1])];
  }

  /** `drop`: the current pelvis drop (m) */
  read(input: Input, dt: number, drop: number) {
    const t = this.tasks;
    const g = this.gait;
    const head = positionTask(input.head, this.headTask);
    // how far the body still travels to where it is heading (riding, it is there: the mount carries it)
    const travel = weightOf(input.mount) > 0 ? 0 : hypot(g.target.x - g.root.x, g.target.z - g.root.z);
    for (let s = 0; s < 2; s++) {
      const hand = s === 0 ? input.leftHand : input.rightHand;
      const task = this.handTasks[s];
      const w = weightOf(hand);
      const pos = w > 0 ? positionOf(hand, task.pos) : null;
      const rot = w > 0 ? quaternionOf(hand, this.handRot[s]) : null;
      task.rot = rot;
      task.weight = w;
      t.hands[s] = pos ? task : null;
      t.reach[s] = this.reach[s].update(pos, rot, w, travel, !!head, dt);
    }
    this.readFeet(input);
    t.head = head;
    t.chest = orientedTask(input.chest, this.chestTask);
    t.hips = orientedTask(input.hips, this.hipsTask);
    t.headRot = weightOf(input.head) > 0 ? quaternionOf(input.head, t.headRot ?? new Quaternion()) : null;
    t.headYaw = t.headRot ? yawOfQuaternion(t.headRot) : null;
    t.look = input.lookAt ? pointOf(input.lookAt, t.look ?? new Vector3()) : null;
    t.floorObstacles = input.floorObstacles ?? NONE;
    t.ground = input.ground ?? NONE;
    t.bodyObstacles = input.bodyObstacles ?? NONE;
    this.leanInto(input.handForce);
    t.approaching = this.approach(t.bodyObstacles);
    this.tracker.update(t, dt);

    const goal = positionTask(input.goal, this.goalTask);
    const facing = goal ? quaternionOf(input.goal, this.goalRot) : null;
    if (goal) goal.yaw = facing ? yawOfQuaternion(facing) : null;
    t.goal = goal;
    const seat = this.seat;
    seat.read(input.seat, g.root, drop);
    if (seat.ownsGoal) t.goal = seat.goalTask(this.goalTask);
    t.seat = seat.seatTask();
    this.active = !!(t.hands[0] || t.hands[1] || t.head || t.chest || t.hips || t.goal || t.look || t.mount);
    this.steerWalk(drop, !!facing && !seat.ownsGoal);
    this.steer.ladders = input.ladders ?? NONE;
  }

  /**
   * The hands exert a force (per kg, `f`) at their height over the feet: the reaction's moment
   * about the feet is balanced by the centre of mass that far ahead of them (f·h / g), as far as
   * the hands hold on.
   */
  private leanInto(f: Vec3 | undefined) {
    const t = this.tasks;
    t.lean.set(0, 0, 0);
    if (!f) return;
    let h = 0;
    let w = 0;
    for (const task of t.reach) {
      if (!task) continue;
      h += (task.pos.y - this.gait.root.y) * task.weight;
      w += task.weight;
    }
    if (w > 0) t.lean.set(f.x, 0, f.z).multiplyScalar(h / w / GRAVITY * Math.min(1, w));
  }

  /** the foot targets: lifting a foot, or, mounted, where the feet stand on the mount */
  private readFeet(input: Input) {
    const t = this.tasks;
    const mount = this.mountTask;
    mount.weight = weightOf(input.mount);
    const mounted = mount.weight > 0 && !!positionOf(input.mount, mount.pos);
    mount.rot = mounted ? quaternionOf(input.mount, this.mountRot) : null;
    mount.lean = clamp(input.mount?.lean ?? 1, 0, 1);
    t.mount = mounted ? mount : null;
    for (let s = 0; s < 2; s++) {
      const e = s === 0 ? input.leftFoot : input.rightFoot;
      const task = positionTask(e, this.footTasks[s]);
      if (task) task.rot = quaternionOf(e, this.footRot[s]);
      t.feet[s] = mounted ? null : task;
      mount.feet[s] = task;
    }
  }

  /**
   * Body obstacles as the body approaches them: each box reaches back toward it by
   * LOOKAHEAD s of its travel (the ceiling is ducked under before the head gets there), and
   * down and up by HEADROOM.
   */
  private approach(obstacles: readonly (Sphere | Box)[]): readonly (Sphere | Box)[] {
    if (obstacles.every(isSphere)) return obstacles;
    const out = this.obstacles;
    out.length = 0;
    const dx = this.gait.velocity.x * LOOKAHEAD;
    const dz = this.gait.velocity.z * LOOKAHEAD;
    let k = 0;
    for (const o of obstacles) {
      if (isSphere(o)) {
        out.push(o);
        continue;
      }
      const b = (this.boxes[k++] ??= { min: new Vector3(), max: new Vector3() });
      b.min.x = o.min.x - Math.max(0, dx);
      b.max.x = o.max.x - Math.min(0, dx);
      b.min.y = o.min.y - HEADROOM * this.d.height;
      b.max.y = o.max.y + HEADROOM * this.d.height;
      b.min.z = o.min.z - Math.max(0, dz);
      b.max.z = o.max.z - Math.min(0, dz);
      out.push(b);
    }
    return out;
  }

  /**
   * The body faces the path only when nothing else dictates where it looks: a goal facing
   * (`holdsFacing`) or a tracked head holds it; a gaze target only when it's well off the
   * travel direction — circling or backing away from something; otherwise people walk
   * facing where they go and turn their head.
   */
  private steerWalk(drop: number, holdsFacing: boolean) {
    const { tasks: t, steer, gait: g } = this;
    const held = !!t.headRot || holdsFacing;
    let faceTravel = held ? 0 : 1;
    if (!held && t.look) {
      const v = g.velocity;
      const look = t.look;
      const off = Math.abs(wrapAngle(yawOf(v.x, v.z) - yawOf(look.x - g.root.x, look.z - g.root.z)));
      faceTravel = hypot(v.x, v.z) > 0.05 ? 1 - smoothstep(1.0, 1.4, off) : 0;
    }
    steer.faceTravel = faceTravel;
    steer.crouched = drop > 0.09 * this.d.height;
    steer.eager = this.tracker.moving;
    steer.maxSpeed = tracksBody(t) ? TRACKED_SPEED : this.maxSpeed;
    steer.pace = this.tracker.pace;
    steer.floorObstacles = t.floorObstacles;
    steer.lean = t.lean;
    steer.handsBusy = !!(t.hands[0] || t.hands[1]);
    steer.ground = t.ground;
  }
}
