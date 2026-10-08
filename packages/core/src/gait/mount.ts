import { Quaternion, Vector3 } from 'three';
import type { MountTask } from '../intent/tasks';
import { GRAVITY, hypot, Pendulum, quatYXZ, smoothstep, Spring, wrapAngle, yawOfQuaternion } from '../math';
import type { Proportions } from '../proportions';
import { bodyYaw, type Stance } from '../stance';
import type { Gait } from './gait';
import { groundAt } from './obstacles';

/** how quickly the body's lean takes up the mount's acceleration (1/s): the trunk's inertia bridges the rest */
const LEAN_RATE = 14;
/** the most it leans (rad) */
const MAX_LEAN = 0.7;
/** the legs as a suspension under the mount's upward jolts: natural frequency (1/s), damping, the most they give (× height) */
const GIVE = { omega: 9, zeta: 0.8, max: 0.15 };
/**
 * Seated on a mount that bounces fast and hard (a trot's two beats a stride, ~2.5–3 Hz, ~8 cm),
 * a rider rises out of the seat on every other bounce and sits on the next (a posting trot):
 * bounces at least this often (Hz) and this big (m peak to peak, default body), the rise (×
 * height, up and forward) and how quickly it comes and goes (1/s).
 */
const POST = { rate: 2.2, size: 0.04, rise: 0.055, fade: 2 };

/** a foot stands on the floor until its ankle is this far above standing flat, off it from this (m, default body: up on the ball, lifted) */
const FLOOR = [0.06, 0.16];

const UP = new Vector3(0, 1, 0);
const LEVEL = new Quaternion();
const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();

/**
 * Riding something that carries the body (a bicycle, a board): while mounted it owns the
 * root and the feet. The feet stand on their targets, or stay where they are on it, and the
 * body faces the way they do; nothing steps — the mount balances. The body inclines about
 * the mount's ground point into its acceleration, as it would to keep its balance in that
 * accelerating frame (atan(a/g): into a turn, back when braking; the trunk's inertia layered
 * on by the gait overlay), and the legs give under its upward jolts (a bump, a landing, a pop).
 */
export class Mount {
  /** the body rides the mount */
  owns = false;
  /** how far it carries the body (0..1): getting on or off, the rest stands on the ground */
  carry = 1;
  /** the mount's horizontal acceleration as the lean has taken it up (m/s²) */
  readonly accel = new Vector3();
  /** the body's inclination into it, about `pivot`: over the mount's ground point, at the feet's level */
  readonly tilt = new Quaternion();
  readonly pivot = new Vector3();
  /** the share of the lean the body takes itself; the rest of the acceleration sways it (the gait overlay) */
  share = 1;
  /** how fast its travel turns (rad/s, smoothed; + = left), its velocity (m/s) */
  turn = 0;
  readonly velocity = new Vector3();
  /** how far the legs give (m, ≤ 0) */
  sink = 0;
  /** how far a seated rider rises out of the seat, posting (m) */
  post = 0;
  /** where it stands on the ground, and how far it moved there this tick */
  readonly position = new Vector3();
  readonly moved = new Vector3();
  private readonly turnRate = new Spring();
  /** its bounces: when the last one was (its lowest point, where it pushes up), how often they come (s), how many, how big (m), whether it is posted to */
  private bounce = { at: -1, period: 1, count: 0, low: 0, high: 0, size: 0, posting: 0, clock: 0 };
  /** ticks ridden: its velocity is known from the second on, its acceleration from the third */
  private ticks = 0;
  private readonly lean = [new Spring(), new Spring()];
  private readonly give = new Pendulum(GIVE.omega, GIVE.zeta);
  /** each foot off the mount's position, as it last stood */
  private readonly offsets = [new Vector3(), new Vector3()];
  /** each foot's heading off the mount's as the body stood getting on */
  private readonly yaws = [0, 0];

  constructor(
    private d: Proportions,
    private stance: Stance,
  ) {}

  /** Ride `task` (null: none — stepping off one); false when not mounted (the gait walks). */
  update(g: Gait, task: MountTask | null, dt: number): boolean {
    if (!task) {
      if (this.owns) this.dismount(g);
      return false;
    }
    if (!this.owns) this.mount(g, task);
    this.move(task.pos, dt);
    this.stand(g, task);
    g.walk -= g.walk * Math.min(1, 6 * dt);
    return true;
  }

  /** getting on: whatever the gait was doing ends; the feet and the root go on from where they are */
  private mount(g: Gait, task: MountTask) {
    const p = task.pos;
    g.jump.end();
    g.climb.reset();
    g.vault.reset();
    g.ladder.reset();
    g.incline.reset(0);
    g.moving = g.starting = false;
    this.position.copy(p);
    this.moved.set(0, 0, 0);
    this.ticks = 0;
    this.velocity.set(0, 0, 0);
    this.turnRate.reset(0);
    for (const s of this.lean) s.reset(0);
    this.give.value = this.give.velocity = 0;
    Object.assign(this.bounce, { at: -1, period: 1, count: 0, low: p.y, high: p.y, size: 0, posting: 0, clock: 0 });
    const heading = task.rot ? yawOfQuaternion(task.rot) : g.root.yaw;
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      this.offsets[s].subVectors(f.pose.ankle, p);
      this.yaws[s] = wrapAngle(f.yaw - heading);
    }
    this.owns = true;
  }

  /** the mount's velocity; its acceleration leans the body and jolts the legs */
  private move(p: Vector3, dt: number) {
    if (dt > 0 && this.ticks++ > 0) {
      const v = _v.subVectors(p, this.position).divideScalar(dt);
      const known = this.ticks > 2;
      const ax = known ? (v.x - this.velocity.x) / dt : 0;
      const ay = known ? (v.y - this.velocity.y) / dt : 0;
      const az = known ? (v.z - this.velocity.z) / dt : 0;
      // (the turn: sideways acceleration over speed)
      const speed = hypot(v.x, v.z);
      this.turn = this.turnRate.step(speed > 0.5 ? (ax * v.z - az * v.x) / (speed * speed) : 0, LEAN_RATE, dt);
      const was = this.velocity.y;
      this.velocity.copy(v);
      this.accel.set(this.lean[0].step(ax, LEAN_RATE, dt), 0, this.lean[1].step(az, LEAN_RATE, dt));
      // (free fall unloads the legs: they don't reach down after the mount, only give under its push)
      this.sink = Math.max(-GIVE.max * this.d.height, Math.min(0, this.give.step(-Math.max(0, ay), dt)));
      this.posting(p.y, v.y, was, dt);
    }
    this.moved.subVectors(p, this.position);
    this.position.copy(p);
  }

  /** a posting trot: rising on every other bounce of the mount once it bounces fast and hard enough */
  private posting(y: number, vy: number, was: number, dt: number) {
    const b = this.bounce;
    b.clock += dt;
    b.low = Math.min(b.low, y);
    b.high = Math.max(b.high, y);
    // (a bounce: its lowest point, where it starts to rise)
    if (vy > 0 && was <= 0 && known(b.at)) {
      b.period += (b.clock - b.at - b.period) * 0.5;
      b.size += (b.high - b.low - b.size) * 0.5;
      b.low = b.high = y;
      b.count++;
      b.at = b.clock;
    } else if (vy > 0 && was <= 0) b.at = b.clock;
    const s = this.d.scale;
    const fast = b.period < 1 / POST.rate && b.size > POST.size * s && b.clock - b.at < 1.5 * b.period;
    b.posting = Math.min(1, Math.max(0, b.posting + (fast ? dt : -dt) * POST.fade));
    // up from one bounce, highest over the next, down onto the seat at the one after
    const phase = ((b.count % 2) + Math.min(1, (b.clock - b.at) / b.period)) / 2;
    this.post = b.posting * POST.rise * this.d.height * Math.sin(Math.PI * phase) ** 2;
  }

  /**
   * The feet on their targets (blended by weight with where they ride), the body facing as
   * they do; the root at their level, inclined over the mount's ground point.
   */
  private stand(g: Gait, task: MountTask) {
    const { stance, d } = this;
    const heading = task.rot ? yawOfQuaternion(task.rot) : g.root.yaw;
    let facing = 0;
    let level = 0;
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const t = task.feet[s];
      const ankle = f.pose.ankle.addVectors(task.pos, this.offsets[s]);
      if (t) ankle.lerp(t.pos, t.weight);
      this.offsets[s].subVectors(ankle, task.pos);
      const rot = quatYXZ(heading + this.yaws[s], 0, 0, _q);
      if (t?.rot) rot.slerp(t.rot, t.weight);
      f.pose.quaternion.copy(rot);
      // (the heading square to the foot's left, whatever its pitch and roll: a leaning pedal's foot still points ahead)
      const left = _v.set(1, 0, 0).applyQuaternion(rot);
      f.yaw = Math.atan2(-left.z, left.x);
      // (+ = toes up; on its ball, heel up, the toes stay level)
      f.pose.pitch = Math.asin(_v.set(0, 0, 1).applyQuaternion(rot).y);
      f.pose.toePitch = Math.max(0, f.pose.pitch);
      f.anchor.copy(ankle);
      f.phase = 'carried';
      f.plantedTime = 0;
      const yaw = bodyYaw(f.yaw, f.side, stance);
      facing = s === 0 ? yaw : facing + wrapAngle(yaw - facing) / 2;
      level += (ankle.y - d.ankleHeight) / 2;
    }
    const { root } = g;
    root.yaw = g.goalYaw = facing;
    g.velocity.set(this.velocity.x, 0, this.velocity.z);
    // up along the effective gravity (g + a, the body's share of it), through the mount's ground point to the feet's level
    const p = task.pos;
    const k = (this.share = task.lean) / GRAVITY;
    _v.set(this.accel.x * k, 1, this.accel.z * k);
    const lean = Math.atan(hypot(_v.x, _v.z));
    if (lean > MAX_LEAN) _v.multiplyScalar(Math.tan(MAX_LEAN) / Math.tan(lean)).setY(1);
    this.pivot.copy(p).addScaledVector(_v, level - p.y);
    this.tilt.setFromUnitVectors(UP, _v.normalize());
    // (getting on or off: from the feet on the floor beside it, as far as it carries the body)
    const w = (this.carry = task.weight);
    if (w < 1) {
      this.pivot.lerp(this.floor(g), 1 - w);
      this.tilt.slerp(LEVEL, 1 - w);
    }
    root.x = this.pivot.x;
    root.y = this.pivot.y;
    root.z = this.pivot.z;
  }

  /**
   * Where the body stands on the floor: between the feet on it (as far as each is, its ankle
   * up to FLOOR above standing flat), drawn to the mount's ground point as they leave it.
   */
  private floor(g: Gait): Vector3 {
    const { d } = this;
    const out = _w.set(0, 0, 0);
    let on = 0;
    for (const f of g.feet) {
      const a = f.pose.ankle;
      const floor = groundAt(g.steer.ground, a.x, a.z);
      const k = 1 - smoothstep(FLOOR[0] * d.scale, FLOOR[1] * d.scale, a.y - floor - d.ankleHeight);
      out.x += k * a.x;
      out.y += k * floor;
      out.z += k * a.z;
      on += k;
    }
    if (on <= 0) return out.copy(this.pivot);
    out.divideScalar(on);
    return out.lerp(this.pivot, 1 - Math.min(1, on));
  }

  /** stepping off: the feet come down flat where they are, the gait takes over */
  private dismount(g: Gait) {
    const { d, root } = g;
    this.owns = false;
    this.sink = 0;
    this.accel.set(0, 0, 0);
    this.tilt.identity();
    root.y = Infinity;
    for (const f of g.feet) {
      const { x, z } = f.pose.ankle;
      const floor = groundAt(g.steer.ground, x, z);
      f.phase = 'planted';
      f.anchor.set(x, floor + d.ankleHeight, z);
      f.pose.ankle.copy(f.anchor);
      f.landPitch = f.pose.pitch = f.pose.toePitch = 0;
      root.y = Math.min(root.y, floor);
    }
    const [a, b] = g.feet;
    root.x = (a.anchor.x + b.anchor.x) / 2;
    root.z = (a.anchor.z + b.anchor.z) / 2;
    g.moving = g.speed > 0.15;
  }
}

const known = (t: number) => t >= 0;
