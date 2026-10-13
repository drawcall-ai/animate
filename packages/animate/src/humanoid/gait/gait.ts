import { Quaternion, Vector3 } from 'three';
import type { Side } from '../bones';
import { clamp, forwardOf, GRAVITY, smoothstep, wrapAngle, yawOf } from '../math';
import type { Proportions } from '../proportions';
import { bodyYaw, OVER_ANKLES, type Stance } from '../stance';
import type { Foot } from '../status';
import { FOOT_HALF_WIDTH } from './foot';
import { runAmount, stepTiming, type Timing } from './timing';

// Root dynamics adapted from the old core (a801be4:packages/core/src/gait/root.ts, turn.ts), without
// the traversals, mounts, strides and pushes.

/** how fast a root that got off its feet is brought back over them (m/s) */
const LEASH_SPEED = 0.6;
/** people brake harder than they accelerate */
const BRAKE_FACTOR = 2.2;
/** the share of the acceleration an approach plans with (arrives without braking hard) */
const PLANNED_ACCEL = 0.8;
/** how quickly the goal's own velocity is picked up (1/s) */
const GOAL_VELOCITY_RATE = 9;
/** a goal moving faster than this (m/s) was re-planned, not carried: it jumped */
const JUMP_SPEED = 4;
/** a walk starts when the goal is this far (m, default body; eager: a tracked part walks), turned (rad) or moving (m/s) */
const START = { distance: 0.14, eagerDistance: 0.05, yaw: 0.45, speed: 0.25, eagerSpeed: 0.1 };
/** it stops once close, slow, the goal still and the facing reached */
const STOP = { distance: 0.05, speed: 0.15, goalSpeed: 0.08, yaw: 0.1 };
/** until the first foot is off the ground the body barely glides (m/s) */
const START_GLIDE = 0.15;
/** the sideways speed a shuffle of hip-wide steps carries (m/s) */
const SHUFFLE = 0.4;
/** how far the body may twist over its feet before turning waits for a step (rad, ~25°) */
const MAX_TWIST = 0.45;
/** the feet stay this far apart sideways under a turning body (m, default body) */
const MIN_ACROSS = 0.05;
/** turning speed (rad/s) and how quickly the facing closes on its goal (1/s) */
const TURN_RATE = 1.5;
const TURN_GAIN = 5;
/** the travel direction's turning is followed above this speed (m/s), this quickly (1/s) */
const TURN_SPEED = 0.3;
const TURN_TRACK_RATE = 6;
/** how quickly the knees give setting off, and straighten again at rest (1/s) */
const BEND_RATE = { give: 5, straighten: 1 };
/** how quickly a body at rest settles over its feet (1/s) */
const SETTLE_RATE = 1.5;
/** people only back up for a short (m), slow (m/s) shuffle to a goal facing away (rad) */
const BACKUP = { distance: 0.6, speed: 0.6, angle: 2.2 };

const _f = new Vector3();
const _over = new Vector3();

/** A foot as the gait steps it: how long it has stood, the pitch it landed with, whether it swings. */
export interface GaitFoot {
  side: Side;
  /** +1 left, −1 right */
  sign: 1 | -1;
  plantedTime: number;
  landPitch: number;
  swinging: boolean;
  /** the swing's duration and progress (0..1) while it swings, and where it left from */
  duration: number;
  progress: number;
  from: Vector3;
  fromYaw: number;
}

/**
 * The state a walk keeps: a root — the ground point the body's centre of mass is carried over,
 * its velocity and facing — moving toward a goal, and the stepping's clock and feet. The root
 * is continuous; the feet step to stay under it (Raibert-style), the body is posed over it.
 */
export class Gait {
  readonly root = new Vector3();
  yaw = 0;
  readonly velocity = new Vector3();
  /** the goal (on the floor) and how fast it moves */
  readonly goal = new Vector3();
  readonly goalVelocity = new Vector3();
  /** how fast the goal speeds up along its way (m/s², − slowing down) */
  goalAccel = 0;
  /** the facing to arrive with (none: the facing it arrives with) */
  goalFacing: number | null = null;
  /** the facing the body is turning to */
  goalYaw = 0;
  /** how fast the travel direction turns (rad/s, + toward +x) */
  turnRate = 0;
  /** how long the extrapolated centre of mass has been out of the feet (s) */
  falling = 0;
  /** it has been under way (and come to rest since, or not) */
  walked = false;
  /** a walk is under way; it has just been started and no foot has lifted yet */
  moving = false;
  starting = false;
  /** 0..1, how much the body walks (smoothed) */
  walk = 0;
  /** how far the knees have given for walking (0 standing tall … 1 ready): from as soon as a walk is under way, before the first step */
  bent = 0;
  /** follow the goal closely: a tracked body part walks */
  eager = false;
  /** the step clock (s), the foot that lifted last and when, and the one that landed last */
  clock = 0;
  lastLift = 1;
  lastLiftAt = -10;
  lastLanded = 1;
  readonly feet: [GaitFoot, GaitFoot];
  /** where the pelvis is carried this frame (the hips' origin) and how it is turned */
  readonly pelvis = new Vector3();
  readonly pelvisRotation = new Quaternion();
  /** ω0 = √(g / leg length) (1/s): how fast the body falls away from its support */
  readonly omega: number;
  private seen = false;

  constructor(
    readonly p: Proportions,
    readonly stance: Stance,
    /** the status's feet the gait steps */
    readonly status: readonly [Foot, Foot],
    /** m/s, m/s² */
    readonly maxSpeed: number,
    readonly accel: number,
  ) {
    const foot = (side: Side, sign: 1 | -1): GaitFoot => ({ side, sign, plantedTime: 10, landPitch: 0, swinging: false, duration: 0, progress: 0, from: new Vector3(), fromYaw: 0 });
    this.feet = [foot('left', 1), foot('right', -1)];
    this.omega = Math.sqrt(GRAVITY / p.legLength);
  }

  /** standing at the ground point `at`, facing `yaw` */
  reset(at: Vector3, yaw: number) {
    this.root.set(at.x, 0, at.z);
    this.goal.copy(this.root);
    this.yaw = this.goalYaw = yaw;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get goalSpeed(): number {
    return Math.hypot(this.goalVelocity.x, this.goalVelocity.z);
  }

  /** 0 walking … 1 running */
  get run(): number {
    return runAmount(this.p, this.speed);
  }

  /** the step timing at the current speed */
  timing(): Timing {
    const speed = this.speed;
    if (speed < 1e-6) return stepTiming(this.p, 0, 1, 0);
    const along = (this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw)) / speed;
    const lateral = Math.abs(this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw)) / speed;
    return stepTiming(this.p, speed, along, lateral);
  }

  /** where a foot stands or, swinging, lands */
  footing(s: number): Vector3 {
    return this.status[s].position;
  }

  /** follows the goal at `to` (on the floor; its velocity fed forward), facing `facing` on arrival */
  aim(to: Readonly<Vector3>, facing: number | null, dt: number) {
    if (this.seen && dt > 0) {
      const k = 1 - Math.exp(-GOAL_VELOCITY_RATE * dt);
      const jx = to.x - this.goal.x;
      const jz = to.z - this.goal.z;
      // (only continuous goal motion counts as velocity; a re-planned, jumping goal doesn't)
      const jump = Math.hypot(jx, jz) > JUMP_SPEED * dt;
      const vx = this.goalVelocity.x;
      const vz = this.goalVelocity.z;
      this.goalVelocity.x += ((jump ? 0 : jx / dt) - vx) * k;
      this.goalVelocity.z += ((jump ? 0 : jz / dt) - vz) * k;
      // (how it speeds up or slows down along its way)
      const speed = this.goalSpeed;
      const along = speed > 1e-3 ? ((this.goalVelocity.x - vx) * this.goalVelocity.x + (this.goalVelocity.z - vz) * this.goalVelocity.z) / (speed * dt) : 0;
      this.goalAccel += (along - this.goalAccel) * k;
    }
    this.seen = true;
    this.goal.set(to.x, 0, to.z);
    this.goalFacing = facing;
  }

  /**
   * Moves the root toward the goal: setting off, speeding up, braking to arrive, turning; its
   * extrapolated centre of mass (`xcom`, the solved body's) kept over its feet sideways.
   */
  update(dt: number, xcom: Readonly<Vector3>) {
    const { root, velocity: v } = this;
    this.clock += dt;
    for (const f of this.feet) if (!f.swinging) f.plantedTime += dt;
    const dx = this.goal.x - root.x;
    const dz = this.goal.z - root.z;
    const dist = Math.hypot(dx, dz);
    const yawErr = wrapAngle((this.goalFacing ?? this.yaw) - this.yaw);
    const scale = this.p.scale;
    if (!this.moving && (dist > (this.eager ? START.eagerDistance : START.distance) * scale || Math.abs(yawErr) > START.yaw || this.goalSpeed > (this.eager ? START.eagerSpeed : START.speed))) {
      this.moving = this.walked = true;
      // gait initiation: the first step goes at once, the body falls into it
      this.starting = true;
    }
    if (this.starting && this.feet.some((f) => f.swinging)) this.starting = false;
    const vx = v.x;
    const vz = v.z;
    if (this.moving) {
      const want = this.wantedVelocity(dx, dz, dist);
      const ddx = want.x - v.x;
      const ddz = want.z - v.z;
      const dvl = Math.hypot(ddx, ddz);
      const braking = want.x * v.x + want.z * v.z < v.x * v.x + v.z * v.z;
      const most = (braking ? BRAKE_FACTOR * this.accel : this.accel) * dt;
      const k = dvl > most ? most / dvl : 1;
      v.x += ddx * k;
      v.z += ddz * k;
      root.x += v.x * dt;
      root.z += v.z * dt;
      this.leash(dt, xcom);
      this.turn(dt, dx, dz, dist);
      if (dist < STOP.distance * scale && this.speed < STOP.speed && this.goalSpeed < STOP.goalSpeed && Math.abs(yawErr) < STOP.yaw) {
        this.moving = this.starting = false;
        v.set(0, 0, 0);
      }
    } else {
      v.set(0, 0, 0);
      // at rest, the body settles over its feet, and squares itself with them
      const k = 1 - Math.exp(-SETTLE_RATE * dt);
      root.lerp(this.over(_over), k);
      this.yaw += wrapAngle(this.feetYaw() - this.yaw) * k;
      this.goalYaw = this.yaw;
    }
    // how fast the travel direction turns
    const v2 = v.x * v.x + v.z * v.z;
    const rate = dt > 0 && v2 > TURN_SPEED * TURN_SPEED ? (v.z * (v.x - vx) - v.x * (v.z - vz)) / (v2 * dt) : 0;
    this.turnRate += (rate - this.turnRate) * Math.min(1, TURN_TRACK_RATE * dt);
    this.walk += (smoothstep(0.08, 0.6, this.speed) - this.walk) * Math.min(1, dt * 6);
    this.bent = Math.max(this.walk, this.bent + ((this.moving ? 1 : 0) - this.bent) * Math.min(1, dt * (this.moving ? BEND_RATE.give : BEND_RATE.straighten)));
  }

  /** the ground velocity that closes (dx, dz) — `dist` away — and arrives at rest, within the speed limit */
  private wantedVelocity(dx: number, dz: number, dist: number): Vector3 {
    const { goalVelocity: gv, accel } = this;
    const catchUp = Math.min(this.maxSpeed, Math.sqrt(2 * accel * PLANNED_ACCEL * dist), 2.5 * dist + 0.4 * Math.sqrt(dist));
    const k = dist > 1e-6 ? catchUp / dist : 0;
    const out = new Vector3(gv.x + dx * k, 0, gv.z + dz * k);
    // brake to arrive: speed toward the goal beyond the goal's own is limited by the stopping distance
    if (dist > 1e-6) {
      const ux = dx / dist;
      const uz = dz / dist;
      const along = out.x * ux + out.z * uz;
      const cap = Math.max(0, gv.x * ux + gv.z * uz) + Math.sqrt(2 * BRAKE_FACTOR * accel * PLANNED_ACCEL * dist);
      if (along > cap) out.addScaledVector(new Vector3(ux, 0, uz), cap - along);
    }
    const cap = this.starting ? Math.min(START_GLIDE, this.maxSpeed) : this.maxSpeed;
    const l = Math.hypot(out.x, out.z);
    if (l > cap) out.multiplyScalar(cap / l);
    return out;
  }

  /**
   * The body can't outrun its feet: its sideways velocity is bounded so its extrapolated centre
   * of mass stays within the lateral span of the feet (where they stand or a swing lands).
   */
  private leash(dt: number, xcom: Readonly<Vector3>) {
    const { root, velocity: v } = this;
    const lx = Math.cos(this.goalYaw);
    const lz = -Math.sin(this.goalYaw);
    const across = v.x * lx + v.z * lz;
    const closing = Math.sign(across) * Math.max(0, Math.abs(across) - SHUFFLE) * 1.5 * this.timing().swing;
    let lo = Infinity;
    let hi = -Infinity;
    this.feet.forEach((f, s) => {
      const p = this.footing(s);
      const l = (p.x - root.x) * lx + (p.z - root.z) * lz - (f.swinging ? closing : 0);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    });
    const edge = FOOT_HALF_WIDTH * this.p.scale;
    const w0 = this.omega;
    const q = (xcom.x - root.x) * lx + (xcom.z - root.z) * lz;
    let want = clamp(across, Math.min((lo - edge) * w0, LEASH_SPEED), Math.max((hi + edge) * w0, -LEASH_SPEED));
    want -= (Math.max(0, q - hi - edge) - Math.max(0, lo - edge - q)) * w0;
    if (want === across) return;
    const dv = (want - across) * Math.min(1, 10 * dt);
    v.x += dv * lx;
    v.z += dv * lz;
  }

  /** turns the facing toward the travel (or the goal's facing, arriving), as fast as a body turns and its feet allow */
  private turn(dt: number, dx: number, dz: number, dist: number) {
    const toGoal = yawOf(dx, dz);
    const travel = toGoal + wrapAngle(yawOf(this.velocity.x, this.velocity.z) - toGoal) * smoothstep(0.35, 0.8, this.speed);
    // (arriving with no facing asked for, the body keeps the one it has)
    const facing = this.goalFacing ?? this.yaw;
    const backwards = Math.abs(wrapAngle(travel - facing)) > BACKUP.angle && dist < BACKUP.distance && this.speed < BACKUP.speed;
    const far = Math.max(smoothstep(0.25, 0.6, dist), smoothstep(0.5, 0.9, this.goalSpeed)) * (backwards ? 0 : 1);
    this.goalYaw = facing + wrapAngle(travel - facing) * far;
    const e = wrapAngle(this.goalYaw - this.yaw);
    const turn = clamp((far * this.turnRate + e * TURN_GAIN) * dt, -TURN_RATE * dt, TURN_RATE * dt);
    this.yaw += this.twistLimit(turn);
  }

  /** the part of `turn` the feet allow: the body twists only so far over them, nor so far that they cross */
  private twistLimit(turn: number): number {
    let sx = 0;
    let sz = 0;
    this.feet.forEach((f, s) => {
      const y = bodyYaw(this.status[s].yaw, f.sign, this.stance);
      sx += Math.sin(y);
      sz += Math.cos(y);
    });
    const yaw = this.yaw + turn;
    const d = wrapAngle(yaw - Math.atan2(sx, sz));
    if (Math.abs(d) > MAX_TWIST && Math.sign(turn) === Math.sign(d)) return 0;
    const a = this.footing(0);
    const b = this.footing(1);
    const across = (a.x - b.x) * Math.cos(yaw) - (a.z - b.z) * Math.sin(yaw);
    const along = (a.x - b.x) * Math.sin(yaw) + (a.z - b.z) * Math.cos(yaw);
    return across < MIN_ACROSS * this.p.scale && turn * along > 0 ? 0 : turn;
  }

  /** where the body stands balanced over its planted feet (into `out`): over the ankles, a little ahead */
  over(out: Vector3): Vector3 {
    out.addVectors(this.status[0].position, this.status[1].position).multiplyScalar(0.5).setY(0);
    return out.addScaledVector(this.forward(_f), OVER_ANKLES * this.p.scale);
  }

  /** the facing the planted feet stand for */
  feetYaw(): number {
    const a = bodyYaw(this.status[0].yaw, 1, this.stance);
    return a + 0.5 * wrapAngle(bodyYaw(this.status[1].yaw, -1, this.stance) - a);
  }

  /** how far the goal goes in `time` s at its speed, slowing to a stop as it slows (m) */
  goalTravel(time: number): number {
    const v = this.goalSpeed;
    const a = this.goalAccel;
    if (a >= 0) return v * time;
    return Math.min(v * time + 0.5 * a * time * time, (v * v) / (-2 * a));
  }

  /** the hip joint of leg `side` as the pelvis is carried this frame */
  hip(side: Side, out: Vector3): Vector3 {
    return out.copy(this.p.offsets[`${side}UpperLeg`]).applyQuaternion(this.pelvisRotation).add(this.pelvis);
  }

  /** the root's facing as a vector */
  forward(out = new Vector3()): Vector3 {
    return forwardOf(this.yaw, out);
  }
}
