// The root's dynamics, from the old core (a801be4:packages/core/src/gait/root.ts, turn.ts; as
// adapted in 738b439:packages/animate/src/humanoid/gait/gait.ts).
import { Quaternion, Vector3 } from 'three';
import type { Side } from '../bones';
import { clamp, forwardOf, GRAVITY, headingOf, smoothstep, wrapAngle } from '../../core/math';
import type { Proportions } from '../proportions';
import { bodyYaw, feetFacing, OVER_ANKLES, type Stance } from '../stance';
import { FOOT_HALF_WIDTH, type Foot } from './foot';
import { runAmount, stepTiming, type Timing } from './timing';

/** how fast a root that got off its feet is brought back over them (m/s) */
const LEASH_SPEED = 0.6;
/** people brake harder than they speed up (when they must) */
export const BRAKE_FACTOR = 2.2;
/** the share of the acceleration an approach plans with (it arrives without braking hard) */
export const PLANNED_ACCEL = 0.8;
/** how hard a planned stop slows (m/s², default body): comfortably, over two or three shortening steps */
const ARRIVAL = 1.0;
/** the facing asked on arrival is turned to once the body is this slow (m/s): first the stop, then the turn */
const ARRIVAL_TURN = [0.3, 0.6] as const;
/** how quickly the goal's own velocity is picked up (1/s) */
const GOAL_VELOCITY_RATE = 9;
/** a goal moving faster than this (m/s) was re-planned, not carried: it jumped */
const JUMP_SPEED = 4;
/** a walk starts when the goal is this far (m, default body), turned (rad; a facing asked: `faced`, just past where it stops) or moving (m/s) */
const START = { distance: 0.14, yaw: 0.45, faced: 0.12, speed: 0.25 };
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
/** the most a walk accelerates the body sideways round a bend (m/s²): ~0.08 g, a tight turn taken slowly (its facing turns no faster than TURN_RATE) */
const LATERAL = 0.8;
/** a goal this far off the facing (rad) is walked to more and more slowly, then turned to first; still, the body edges toward it this fast (m/s) */
const TURN_FIRST = [0.6, 1.3] as const;
const TURNING_SPEED = 0.15;
/** Short side or back repositions keep the requested facing (m, m/s, rad; read from the former backing rule). */
const REPOSITION = { distance: 0.6, speed: 0.6, backAngle: 2.2 };

/** A foot as the steps take it: how long it has stood, the pitch it landed with, its swing while it swings. */
export interface Stepping {
  side: Side;
  /** +1 left, −1 right */
  sign: 1 | -1;
  plantedTime: number;
  landPitch: number;
  /** planted, how it is rolled (rad) the two last sub-steps */
  roll: [number, number];
  swing: Swing | null;
}

/** A step under way: from where, how long, how high, how it strikes; the landing is the foot's (`Foot.position`). */
export interface Swing {
  /** the ankle at lift-off, and the foot's heading */
  from: Vector3;
  fromYaw: number;
  duration: number;
  /** 0 → 1 */
  progress: number;
  /** the ankle's rise over its straight path (m) */
  lift: number;
  /** the foot's pitch at heel strike (rad, + toes up) */
  strike: number;
  /** a step from standing: lifted gently and carried level */
  standing: boolean;
  /** how the foot left the floor: its ankle's angle to the shank and roll rate (rad, rad/s), the ankle's velocity off its path, the hip then and where it will be on landing */
  liftAnkle: number;
  liftRate: number;
  liftVelocity: Vector3;
  hip: Vector3;
  hipLanding: Vector3;
}

/**
 * What `balance` carries the body on: a root — the ground point the centre of mass is carried over,
 * its velocity and facing — moving toward a goal, and the steps' clock and feet. The root is
 * continuous; the feet step to stay under it (Raibert-style), the body is posed over it.
 */
export class Carriage {
  readonly root = new Vector3();
  yaw = 0;
  readonly velocity = new Vector3();
  /** the goal (on the floor) and how fast it moves, speeds up along its way (m/s²) */
  readonly goal = new Vector3();
  readonly goalVelocity = new Vector3();
  goalAccel = 0;
  /** the facing to arrive with (none: the facing it arrives with), the facing it turns to now */
  goalFacing: number | null = null;
  goalYaw = 0;
  /** how fast it may go (m/s) and speed up (m/s²), as last asked */
  maxSpeed = 1.3;
  accel = 1.2;
  /** squares its feet on arriving */
  plant = true;
  /** let down or up on its toes (as asked): its feet stay where they stand but to catch a fall */
  lowered = false;
  /** how fast it may turn (rad/s; default a walk's) */
  turnSpeed: number | undefined = undefined;
  /** how fast the travel direction turns (rad/s, + toward +x) */
  turnRate = 0;
  /** how fast the goal's way turns (rad/s, + left) */
  private goalTurn = 0;
  /** how long the extrapolated centre of mass has been out of the feet (s) */
  falling = 0;
  /** it has walked (and come to rest since, or not); a walk is under way; it was just started and no foot has lifted yet */
  walked = false;
  moving = false;
  starting = false;
  /** the goal is so far off the facing that the body turns where it stands before it goes */
  private turningFirst = false;
  /** 0 standing … 1 walking (smoothed) */
  walk = 0;
  /** how far the knees have given for walking (0 standing tall … 1 ready) */
  bent = 0;
  /** the step clock (s), the foot that lifted last and when, the one that landed last */
  clock = 0;
  lastLift = 1;
  lastLiftAt = -10;
  lastLanded = 1;
  readonly steps: [Stepping, Stepping];
  /** where the pelvis is carried this sub-step (the hips' origin), turned how */
  readonly pelvis = new Vector3();
  readonly pelvisRotation = new Quaternion();
  /** ω0 = √(g / leg length) (1/s): how fast the body falls away from its support */
  readonly omega: number;
  /** a goal has been asked before (none asked now: it stops where it can) */
  private asked = false;
  private seen = false;

  constructor(
    readonly p: Proportions,
    /** the stance it stands in now (set every sub-step) */
    public stance: Stance,
    /** the feet [left, right]: where they stand or land */
    readonly feet: readonly [Foot, Foot],
  ) {
    const stepping = (side: Side, sign: 1 | -1): Stepping => ({ side, sign, plantedTime: 10, landPitch: 0, roll: [0, 0], swing: null });
    this.steps = [stepping('left', 1), stepping('right', -1)];
    this.omega = Math.sqrt(GRAVITY / p.legLength);
  }

  /** standing at the ground point `at`, facing `yaw` */
  reset(at: Readonly<Vector3>, yaw: number) {
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

  /**
   * The goal this sub-step: the floor point `to` (its velocity fed forward: given, or as it
   * moves), facing `facing` on arrival. Without a goal, a body under way stops where it can.
   */
  aim(to: Readonly<Vector3> | null, velocity: Readonly<Vector3> | null, facing: number | null, dt: number) {
    if (!to) {
      // (no goal asked: under way, it comes to a stop ahead, braking as it does arriving)
      if (this.asked && this.moving) {
        const stop = (this.speed * this.speed) / (2 * ARRIVAL * this.p.scale);
        this.goal.copy(this.velocity).setLength(stop).add(this.root);
      } else if (!this.moving) this.goal.copy(this.root);
      this.asked = false;
      this.goalVelocity.set(0, 0, 0);
      this.goalAccel = 0;
      this.goalTurn = 0;
      this.goalFacing = facing;
      this.seen = false;
      return;
    }
    this.asked = true;
    const was = _was.copy(this.goalVelocity);
    if (velocity) this.goalVelocity.set(velocity.x, 0, velocity.z);
    else if (this.seen && dt > 0) {
      const k = 1 - Math.exp(-GOAL_VELOCITY_RATE * dt);
      const jx = to.x - this.goal.x;
      const jz = to.z - this.goal.z;
      // (only continuous goal motion counts as velocity; a re-planned, jumping goal doesn't)
      const jump = Math.hypot(jx, jz) > JUMP_SPEED * dt;
      this.goalVelocity.x += ((jump ? 0 : jx / dt) - this.goalVelocity.x) * k;
      this.goalVelocity.z += ((jump ? 0 : jz / dt) - this.goalVelocity.z) * k;
    }
    // (how it speeds up or slows down along its way)
    const speed = this.goalSpeed;
    const along = speed > 1e-3 && this.seen ? ((this.goalVelocity.x - was.x) * this.goalVelocity.x + (this.goalVelocity.z - was.z) * this.goalVelocity.z) / (speed * dt) : 0;
    this.goalAccel += (along - this.goalAccel) * (1 - Math.exp(-GOAL_VELOCITY_RATE * dt));
    // (and how fast its way turns)
    const gv = this.goalVelocity;
    const turning = speed > TURN_SPEED && this.seen && dt > 0 ? (gv.z * (gv.x - was.x) - gv.x * (gv.z - was.z)) / (speed * speed * dt) : 0;
    this.goalTurn += (turning - this.goalTurn) * (1 - Math.exp(-GOAL_VELOCITY_RATE * dt));
    this.seen = true;
    this.goal.set(to.x, 0, to.z);
    this.goalFacing = facing;
  }

  /**
   * Moves the root toward the goal: setting off, speeding up, braking to arrive, turning; its
   * extrapolated centre of mass (`xcom`) kept over its feet sideways. At rest, it settles over
   * its feet (`over`: where the stance holds the centre of mass).
   */
  update(dt: number, xcom: Readonly<Vector3>, over: Readonly<Vector3>) {
    const { root, velocity: v } = this;
    this.clock += dt;
    for (const s of this.steps) if (!s.swing) s.plantedTime += dt;
    const dx = this.goal.x - root.x;
    const dz = this.goal.z - root.z;
    const dist = Math.hypot(dx, dz);
    const yawErr = wrapAngle((this.goalFacing ?? this.yaw) - this.yaw);
    const scale = this.p.scale;
    if (!this.moving && (dist > START.distance * scale || Math.abs(yawErr) > (this.goalFacing === null ? START.yaw : START.faced) || this.goalSpeed > START.speed)) {
      this.moving = this.walked = true;
      // gait initiation: the first step goes at once, the body falls into it
      this.starting = true;
    }
    if (this.starting && this.steps.some((s) => s.swing)) this.starting = false;
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
      // (turning where it stands, the body stays over its feet as they step round)
      const settle = 1 - smoothstep(STOP.distance, START.distance, dist);
      if ((settle > 0 && this.goalSpeed < STOP.goalSpeed) || this.turningFirst) {
        const k = (1 - Math.exp(-SETTLE_RATE * dt)) * (this.turningFirst ? 1 : settle);
        root.x += (over.x - root.x) * k;
        root.z += (over.z - root.z) * k;
      }
      if (dist < STOP.distance * scale && this.speed < STOP.speed && this.goalSpeed < STOP.goalSpeed && Math.abs(yawErr) < STOP.yaw) {
        this.moving = this.starting = false;
        v.set(0, 0, 0);
      }
    } else {
      v.set(0, 0, 0);
      // at rest, the body settles over its feet, and squares itself with them
      const k = 1 - Math.exp(-SETTLE_RATE * dt);
      root.x += (over.x - root.x) * k;
      root.z += (over.z - root.z) * k;
      this.yaw += wrapAngle(this.feetYaw() - this.yaw) * k;
      this.goalYaw = this.yaw;
    }
    const v2 = v.x * v.x + v.z * v.z;
    const rate = dt > 0 && v2 > TURN_SPEED * TURN_SPEED ? (v.z * (v.x - vx) - v.x * (v.z - vz)) / (v2 * dt) : 0;
    this.turnRate += (rate - this.turnRate) * Math.min(1, TURN_TRACK_RATE * dt);
    this.walk += (smoothstep(0.08, 0.6, this.speed) - this.walk) * Math.min(1, dt * 6);
    this.bent = Math.max(this.walk, this.bent + ((this.moving ? 1 : 0) - this.bent) * Math.min(1, dt * (this.moving ? BEND_RATE.give : BEND_RATE.straighten)));
  }

  /** A short reposition may keep its facing while stepping sideways or back. */
  get shuffling(): boolean {
    return Math.hypot(this.goal.x - this.root.x, this.goal.z - this.root.z) < REPOSITION.distance && this.goalSpeed < STOP.goalSpeed;
  }

  /** the ground velocity that closes (dx, dz) — `dist` away — and arrives at rest, within the speed limit */
  private wantedVelocity(dx: number, dz: number, dist: number): Vector3 {
    const { goalVelocity: gv, accel } = this;
    const catchUp = Math.min(this.maxSpeed, Math.sqrt(2 * accel * PLANNED_ACCEL * dist), 2.5 * dist + 0.4 * Math.sqrt(dist));
    const k = dist > 1e-6 ? catchUp / dist : 0;
    const out = _want.set(gv.x + dx * k, 0, gv.z + dz * k);
    // brake to arrive: speed toward the goal beyond the goal's own is limited by the stopping distance
    if (dist > 1e-6) {
      const ux = dx / dist;
      const uz = dz / dist;
      const along = out.x * ux + out.z * uz;
      const cap = Math.max(0, gv.x * ux + gv.z * uz) + Math.sqrt(2 * Math.min(ARRIVAL * this.p.scale, accel) * dist);
      if (along > cap) out.add(_u.set(ux, 0, uz).multiplyScalar(cap - along));
    }
    // (no faster round a bend than the feet hold the body sideways; and a goal far off the facing is
    // turned to first: nobody walks off sideways or backward but for a short shuffle)
    // (the bend it is on, or the goal's way ahead of it)
    const bend = Math.min(this.maxSpeed, LATERAL / Math.max(1e-6, Math.abs(this.turnRate), Math.abs(this.goalTurn)));
    const off = Math.abs(wrapAngle(headingOf(dx, dz) - this.yaw));
    // (but a short shuffle back to a goal that stays put)
    const turned = this.shuffling ? 1 : 1 - smoothstep(TURN_FIRST[0], TURN_FIRST[1], off);
    // (a body standing turns first; one walking edges on round)
    const cap = Math.max(this.speed > TURNING_SPEED ? TURNING_SPEED : 0, Math.min(this.starting ? START_GLIDE : bend, this.maxSpeed * turned));
    this.turningFirst = cap <= 0;
    const l = Math.hypot(out.x, out.z);
    if (l > cap) out.multiplyScalar(cap / l);
    return out;
  }

  /** the body can't outrun its feet: its sideways velocity keeps its extrapolated centre of mass within the feet's lateral span (where they stand or land) */
  private leash(dt: number, xcom: Readonly<Vector3>) {
    const { root, velocity: v } = this;
    const lx = Math.cos(this.yaw);
    const lz = -Math.sin(this.yaw);
    const across = v.x * lx + v.z * lz;
    const closing = Math.sign(across) * Math.max(0, Math.abs(across) - SHUFFLE) * 1.5 * this.timing().swing;
    let lo = Infinity;
    let hi = -Infinity;
    this.steps.forEach((s, i) => {
      const at = this.feet[i].position;
      const l = (at.x - root.x) * lx + (at.z - root.z) * lz - (s.swing ? closing : 0);
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
    const toGoal = headingOf(dx, dz);
    const travel = toGoal + wrapAngle(headingOf(this.velocity.x, this.velocity.z) - toGoal) * smoothstep(0.35, 0.8, this.speed);
    const facing = this.goalFacing ?? this.yaw;
    const along = dx * Math.sin(facing) + dz * Math.cos(facing);
    const across = dx * Math.cos(facing) - dz * Math.sin(facing);
    const sideways = this.goalFacing !== null && along < Math.abs(across);
    const backwards = Math.abs(wrapAngle(travel - facing)) > REPOSITION.backAngle;
    const shuffle = dist < REPOSITION.distance && this.speed < REPOSITION.speed && (backwards || (sideways && this.goalSpeed < STOP.goalSpeed));
    const far = Math.max(smoothstep(0.25, 0.6, dist), smoothstep(0.5, 0.9, this.goalSpeed), smoothstep(ARRIVAL_TURN[0], ARRIVAL_TURN[1], this.speed)) * (shuffle ? 0 : 1);
    this.goalYaw = facing + wrapAngle(travel - facing) * far;
    const e = wrapAngle(this.goalYaw - this.yaw);
    const most = (this.turnSpeed ?? TURN_RATE) * dt;
    const turn = clamp((far * this.turnRate + e * TURN_GAIN) * dt, -most, most);
    this.yaw += this.twistLimit(turn);
  }

  /** the part of `turn` the feet allow: the body twists only so far over them, nor so far that they cross */
  private twistLimit(turn: number): number {
    let sx = 0;
    let sz = 0;
    this.steps.forEach((s, i) => {
      const y = bodyYaw(this.feet[i].yaw, s.sign, this.stance);
      sx += Math.sin(y);
      sz += Math.cos(y);
    });
    const yaw = this.yaw + turn;
    const d = wrapAngle(yaw - Math.atan2(sx, sz));
    // (slowing into the twist's end, not stopping at it: the facing turns smoothly)
    if (Math.sign(turn) === Math.sign(d)) turn *= 1 - smoothstep(0.7 * MAX_TWIST, MAX_TWIST, Math.abs(d));
    const a = this.feet[0].position;
    const b = this.feet[1].position;
    const across = (a.x - b.x) * Math.cos(yaw) - (a.z - b.z) * Math.sin(yaw);
    const along = (a.x - b.x) * Math.sin(yaw) + (a.z - b.z) * Math.cos(yaw);
    return across < MIN_ACROSS * this.p.scale && turn * along > 0 ? 0 : turn;
  }

  /** where the body stands balanced over its feet (into `out`): over the ankles, a little ahead */
  over(out: Vector3): Vector3 {
    out.addVectors(this.feet[0].position, this.feet[1].position).multiplyScalar(0.5).setY(0);
    return out.addScaledVector(forwardOf(this.yaw, _f), OVER_ANKLES * this.p.scale);
  }

  /** the facing the planted feet stand for */
  feetYaw(): number {
    return feetFacing(this.feet[0].yaw, this.feet[1].yaw, this.stance);
  }

  /** how far the goal goes in `time` s at its speed, slowing to a stop as it slows (m) */
  goalTravel(time: number): number {
    const v = this.goalSpeed;
    const a = this.goalAccel;
    if (a >= 0) return v * time;
    return Math.min(v * time + 0.5 * a * time * time, (v * v) / (-2 * a));
  }

  /** the hip joint of leg `side` as the pelvis is carried this sub-step */
  hip(side: Side, out: Vector3): Vector3 {
    return out.copy(this.p.offsets[`${side}UpperLeg`]).applyQuaternion(this.pelvisRotation).add(this.pelvis);
  }
}

const _f = new Vector3();
const _was = new Vector3();
const _want = new Vector3();
const _u = new Vector3();
