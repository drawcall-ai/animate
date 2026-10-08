import { Vector3 } from 'three';
import { hypot, Spring } from '../math';
import type { Tasks } from './tasks';

/** horizontal speed (m/s) above which a tracked body part counts as walking */
const MOVING_SPEED = 0.12;
/** a tracked target moving this far in one tick is a jump (m) */
const TARGET_JUMP = 0.05;
/** hands faster than `from` (m/s, over what carries the body) strike or throw: each `speed` (m/s) beyond turns and shifts the body once more as fast as unhurried */
const STRIKE = { from: 3, speed: 1 };

/**
 * Measures how the tracked inputs move. The tracked body part (head, chest or pelvis):
 * is it translating — walking — rather than just turning or bending, and does its path
 * already carry the vertical bob of real walking (real trackers do, scripted paths
 * don't)? Did a tracked target jump this tick, and how fast do the hand targets move?
 */
export class Tracker {
  /** the tracked part is translating: the feet follow it eagerly */
  moving = false;
  /** recent vertical oscillation amplitude of the tracked path (m) */
  bob = 0;
  /** a tracked head/chest/pelvis target jumped this tick */
  jumped = false;

  private prev = new Vector3();
  private speed = new Spring();
  private meanY = new Spring();
  private seen = false;
  private lastTargets = [new Vector3(), new Vector3(), new Vector3()];
  private handSpeedSpring = new Spring();
  private strikeSpring = new Spring();
  private prevHand = [new Vector3(), new Vector3()];
  /** where the mount was last tick (null: not riding) */
  private prevMount: Vector3 | null = null;
  private mountAt = new Vector3();
  private carried = new Vector3();

  /** smoothed speed of the fastest hand target acted on (m/s, weighted): fast hands mean strikes, throws */
  get handSpeed() {
    return this.handSpeedSpring.value;
  }

  /** how many times faster than unhurried the body turns and shifts: fast hands (strikes, throws) drive it */
  get pace() {
    return 1 + Math.max(0, this.strikeSpring.value - STRIKE.from) / STRIKE.speed;
  }

  update(t: Tasks, dt: number) {
    this.followBody(t.head?.pos ?? t.hips?.pos ?? t.chest?.pos ?? null, dt);
    this.jumped = false;
    this.follow(0, t.head?.pos);
    this.follow(1, t.chest?.pos);
    this.follow(2, t.hips?.pos);
    // (riding, hands moving along with the mount don't strike)
    const carried = t.mount && this.prevMount ? this.carried.subVectors(t.mount.pos, this.prevMount) : this.carried.set(0, 0, 0);
    this.prevMount = t.mount ? this.mountAt.copy(t.mount.pos) : null;
    let speed = 0;
    let strike = 0;
    for (let s = 0; s < 2; s++) {
      const h = t.reach[s];
      if (!h) continue;
      const prev = this.prevHand[s];
      if (dt > 0) speed = Math.max(speed, (h.pos.distanceTo(prev) / dt) * h.weight);
      if (dt > 0) strike = Math.max(strike, (prev.add(carried).distanceTo(h.pos) / dt) * h.weight);
      prev.copy(h.pos);
    }
    this.handSpeedSpring.step(speed, 20, dt);
    this.strikeSpring.step(strike, 20, dt);
  }

  /** notes where tracked target `i` is now, and whether it jumped there */
  private follow(i: number, pos: Vector3 | null | undefined) {
    if (!pos) return;
    if (pos.distanceTo(this.lastTargets[i]) > TARGET_JUMP) this.jumped = true;
    this.lastTargets[i].copy(pos);
  }

  private followBody(tracked: Vector3 | null, dt: number) {
    if (tracked && dt > 0) {
      const v = hypot(tracked.x - this.prev.x, tracked.z - this.prev.z) / dt;
      this.prev.set(tracked.x, this.prev.y, tracked.z);
      this.speed.step(Math.min(v, 3), 6, dt);
    } else this.speed.step(0, 6, dt);
    this.moving = this.speed.value > MOVING_SPEED;

    if (!tracked || dt <= 0) {
      this.seen = false;
      return;
    }
    if (!this.seen) this.meanY.reset(tracked.y);
    this.seen = true;
    const dev = Math.abs(tracked.y - this.meanY.step(tracked.y, 3, dt));
    this.bob = Math.max(dev, this.bob * Math.exp(-dt / 0.8));
  }
}
