import { Vector3 } from 'three';
import type { Box, Ladder } from '../input';
import type { MountTask, Task } from '../intent/tasks';
import { clamp, forwardOf, hypot, leftOf, lerp, Spring } from '../math';
import type { Proportions } from '../proportions';
import { footYaw, stanceFeet, type Stance } from '../stance';
import { Capture } from './capture';
import { GaitFoot } from './foot';
import { steppable } from './obstacles';
import { FootRoll } from './roll';
import { Climb } from './climb';
import { LadderClimb } from './ladder';
import { Vault } from './vault';
import type { Move } from './sequence';
import { Jump } from './jump';
import { Mount } from './mount';
import { updateRoot } from './root';
import { triggerStep } from './steps';
import { advanceSwings, updateLifted } from './swing';
import { runAmount, stepTiming, type Timing } from './timing';

export interface Root {
  x: number;
  /** the level the body is carried at (m): the floor's (0) standing, its flight's in the air */
  y: number;
  z: number;
  yaw: number;
}

/** How the intent steers the walk this tick. */
export interface Steer {
  /** 1 = turn to face the travel direction when walking somewhere, 0 = hold the goal's facing */
  faceTravel: number;
  /** deep crouch: no idle adjustment steps */
  crouched: boolean;
  /** follow the goal closely (a tracked body part is walking, or the plan moves off): start/stop moving on small offsets */
  eager: boolean;
  /** m/s */
  maxSpeed: number;
  /** how many times faster than walking the facing turns (a strike or throw turns the body over its feet) */
  pace: number;
  /** boxes on the floor: the low ones are stepped over, feet never land on them */
  floorObstacles: readonly Box[];
  /** boxes whose tops are floor to stand on */
  ground: readonly Box[];
  /** ladders up to ground */
  ladders: readonly Ladder[];
  /** where balance holds the centre of mass off the feet (m): leaning into the force the hands exert */
  lean: Vector3;
  /** the hands have targets: they hold or reach for something (no vaulting over it) */
  handsBusy: boolean;
}

/** how far ahead a moving goal is followed to see what is on the way (s) */
const LOOK = 3;
/** a goal moving faster than this (m/s) was re-planned, not moved */
const JUMPED = 4;
/** how many times faster than walking the facing turns over a stride (the hips open over it), until this long after it is put down (s) */
const STRIDE = { pace: 3, time: 0.3 };
/** how quickly the root follows the ground level its feet stand on (1/s): about a swing */
const LEVEL_RATE = 12;
/**
 * that level: between the lowest foot's and the feet's mean, so that the knee meets a step
 * up at ~60° and one down nearly straight, the stance leg lowering the body after it lands
 * (Riener 2002: ascent contact 55–65°, descent 10–20°)
 */
const LEVEL_MEAN = 0.6;
/** the incline is judged over at least this speed (m/s), and smoothed at this rate (1/s) */
const INCLINE_SPEED = 0.3;
const INCLINE_RATE = 3;

const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _f = new Vector3();
const _l = new Vector3();

/**
 * Root locomotion + event-driven stepping. The root is a continuous "where my
 * body is" point that approaches the planner's target; the feet are
 * discrete supports that step to stay under it (Raibert-style placement).
 * The gait alone moves the feet: their contacts, swings and poses.
 */
export class Gait {
  readonly root: Root = { x: 0, y: 0, z: 0, yaw: 0 };
  readonly velocity = new Vector3();
  readonly feet: [GaitFoot, GaitFoot];
  /** the posed body's extrapolated centre of mass: what the steps keep supported */
  readonly capture: Capture;
  /** a walk is under way */
  moving = false;
  /** 0..1 smoothed "walking" amount */
  walk = 0;
  /** the foot that landed last */
  lastLanded = 1;
  steer: Steer = { faceTravel: 1, crouched: false, eager: false, maxSpeed: Infinity, pace: 1, floorObstacles: [], ground: [], ladders: [], lean: new Vector3(), handsBusy: false };
  /** the floor obstacles low enough to step over: the swing clears them, feet never land on them */
  readonly lowObstacles: Box[] = [];
  /** a two-footed jump across a gap too wide to step: while under way it owns the root and the feet */
  readonly jump: Jump;
  /** a climb onto ground too high to step onto: while under way it owns the root, the feet and the hands */
  readonly climb: Climb;
  /** a vault over a wall too tall to step over: while under way it owns the root, the feet and a hand */
  readonly vault: Vault;
  /** a ladder up to ground: while under way it owns the root, the feet and the hands */
  readonly ladder: LadderClimb;
  /** riding something that carries the body: while mounted it owns the root and the feet */
  readonly mount: Mount;

  // ---- state shared by the gait's parts
  /** the facing the body is turning to */
  goalYaw = 0;
  /** where the goal is heading: LOOK s on as it moves (a gap or a wall on the way is seen before the goal gets there) */
  readonly ahead = new Vector3();
  /** the goal as last given (x, z), and how it moves (m/s) */
  private readonly goal = new Vector3();
  private readonly goalVel = new Vector3();
  /** where the body is heading (the planner's goal), and how that moves */
  readonly target: Root = { x: 0, y: 0, z: 0, yaw: 0 };
  readonly targetVel = new Vector3();
  /** how fast the travel direction turns (rad/s, + = toward +x): the path curves */
  turnRate = 0;
  /** a foot target holds the body where it stands: the foot waits to lift (the weight shifting onto the other), or is up */
  footHeld = false;
  /** a walk has just been started and no foot has lifted yet */
  starting = false;
  /** running step clock: which foot lifted last, and when */
  clock = 0;
  lastLift = 1;
  lastLiftAt = -10;
  private footRoll: FootRoll;
  /** the root's level on its way to the ground the feet stand on */
  private level = new Spring();
  /** how steeply the body is climbing (+) or descending (−) as it goes: rise over run, smoothed */
  readonly incline = new Spring();
  private stepTimes: Timing = { stepT: 0, swing: 0, doubleSupport: 0, stance: 0, run: 0 };

  constructor(
    readonly d: Proportions,
    readonly stance: Stance,
    /** how quickly the body speeds up (m/s²) */
    readonly accel: number,
  ) {
    this.feet = [new GaitFoot(1, d), new GaitFoot(-1, d)];
    this.capture = new Capture(d);
    this.footRoll = new FootRoll(d, stance);
    this.jump = new Jump(d, stance);
    this.climb = new Climb(d, stance);
    this.vault = new Vault(d, stance);
    this.ladder = new LadderClimb(d, stance);
    this.mount = new Mount(d, stance);
  }

  reset(x: number, z: number, yaw: number) {
    Object.assign(this.root, { x, y: 0, z, yaw });
    Object.assign(this.target, { x, y: 0, z, yaw });
    this.goal.set(x, 0, z);
    this.goalVel.set(0, 0, 0);
    this.jump.end();
    this.climb.reset();
    this.vault.reset();
    this.ladder.reset();
    this.goalYaw = yaw;
    this.velocity.set(0, 0, 0);
    this.targetVel.set(0, 0, 0);
    this.moving = false;
    this.walk = 0;
    this.turnRate = 0;
    this.capture.reset(x, z);
    stanceFeet(x, z, forwardOf(yaw, _f), leftOf(yaw, _l), this.d, this.stance, _homes);
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      f.phase = 'planted';
      f.anchor.copy(_homes[s]);
      f.yaw = footYaw(yaw, f.side, this.stance);
      f.pose.pitch = 0;
      f.plantedTime = 10;
      f.pose.ankle.copy(f.anchor);
    }
  }

  /** the traversal under way or approached (at rest, the climb's: its curves are zero then) */
  get move(): Move {
    return this.vault.owns ? this.vault : this.ladder.owns ? this.ladder : this.climb;
  }

  /**
   * The speed limit: the steer's, and a step planned around an obstacle sets the pace —
   * the body travels one step per step time (shortened / high, slow steps slow it — it
   * can't outrun its feet).
   */
  get maxSpeed() {
    let pace = Infinity;
    for (const f of this.feet) if (f.phase === 'swing') pace = Math.min(pace, f.swing.pace);
    return Math.min(this.steer.maxSpeed, pace);
  }

  /** how many times faster than unhurried the posture moves: striking (the steer's), or striding onto a foot */
  get pace() {
    return this.striding ? Math.max(this.steer.pace, STRIDE.pace) : this.steer.pace;
  }

  /** how many times faster than walking the facing turns: striking, or once a stride is put down (the hips open over the front foot) */
  get turnPace() {
    return this.feet.some((f) => f.strided && f.plantedTime < STRIDE.time) ? Math.max(this.steer.pace, STRIDE.pace) : this.steer.pace;
  }

  /** a foot is striding, or has just been put down from a stride: the body goes onto it (the other foot waits) */
  get striding() {
    return this.feet.some((f) => f.striding > 0.5 || (f.strided && f.plantedTime < STRIDE.time));
  }

  get speed() {
    return hypot(this.velocity.x, this.velocity.z);
  }

  /** how fast the goal moves (m/s) */
  get targetSpeed() {
    return hypot(this.targetVel.x, this.targetVel.z);
  }

  /** 0 = walking, 1 = running (riding, neither: the mount's speed is not the legs') */
  get run() {
    return this.mount.owns ? 0 : runAmount(this.d, this.speed);
  }

  /** step timing for the current speed (one object, rewritten by every call) */
  timing(): Timing {
    return stepTiming(this.d, this.velocity, this.root.yaw, this.stepTimes);
  }

  /** Move the root toward `target` and step the feet under it; `liftTasks` hold feet up (kicks); a `mount` carries the body. */
  update(dt: number, target: Root, steer: Steer, liftTasks: readonly [Task | null, Task | null], mount: MountTask | null) {
    this.steer = steer;
    this.lowObstacles.length = 0;
    // (the gap a jump crosses is the jump's, not the steps')
    const jumped = this.jump.owns || this.jump.phase === 'recover' ? this.jump.over : null;
    for (const o of steer.floorObstacles) if (steppable(o, this.d) && o !== jumped) this.lowObstacles.push(o);
    this.clock += dt;
    this.footHeld = !!(liftTasks[0] || liftTasks[1]);
    // (a mount or a move under way sets the root's level itself: the level spring holds still)
    const owned = this.mount.update(this, mount, dt) || this.jump.update(this, dt) || this.climb.update(this, dt) || this.vault.update(this, dt) || this.ladder.update(this, dt);
    if (owned) this.level.velocity = 0;
    else {
      this.follow(target, dt);
      updateRoot(this, dt, this.vault.aim(this, this.climb.aim(this, this.ladder.aim(this, this.jump.aim(this, target)))));
      this.stand(dt);
    }
    const t = this.timing();
    for (const f of this.feet) if (f.phase === 'planted') f.plantedTime += dt;
    if (owned) return;
    updateLifted(this, liftTasks, dt);
    triggerStep(this, t);
    advanceSwings(this, dt, t);
  }

  /** follow where the goal is heading */
  private follow(target: Root, dt: number) {
    const { goal, goalVel } = this;
    if (dt > 0) {
      const vx = (target.x - goal.x) / dt;
      const vz = (target.z - goal.z) / dt;
      // (a goal that jumped was re-planned, not moved)
      const moved = hypot(vx, vz) < JUMPED ? 1 - Math.exp(-9 * dt) : 0;
      goalVel.x += (vx - goalVel.x) * moved;
      goalVel.z += (vz - goalVel.z) * moved;
    }
    goal.set(target.x, 0, target.z);
    this.ahead.copy(goalVel).multiplyScalar(LOOK).add(goal);
  }

  /**
   * The root is carried at the level of the ground the feet stand on or step onto (LEVEL_MEAN):
   * stepping up, the body rises over the leading leg as the trailing one swings up; stepping
   * down, it lowers on the standing leg as the other swings down (McFadyen & Winter 1988).
   */
  private stand(dt: number) {
    let low = Infinity;
    let mean = 0;
    let n = 0;
    for (const f of this.feet) {
      if (f.phase === 'lifted') continue;
      const y = f.footing.y - this.d.ankleHeight;
      low = Math.min(low, y);
      mean += y;
      n++;
    }
    if (!n) return;
    this.level.value = this.root.y;
    this.root.y = this.level.step(lerp(low, mean / n, LEVEL_MEAN), LEVEL_RATE, dt);
    // (how steeply the body rises or sinks as it goes)
    this.incline.step(clamp(this.level.velocity / Math.max(this.speed, INCLINE_SPEED), -1, 1), INCLINE_RATE, dt);
  }

  /** Roll the planted feet under the hip joints (`hips`: [left, right]) and pose every foot. */
  roll(hips: readonly [Vector3, Vector3], dt: number) {
    this.jump.pose(this, hips);
    this.climb.pose(this, hips);
    this.vault.pose(this, hips);
    this.ladder.pose(this, hips);
    this.footRoll.update(this, hips, dt);
  }

  /** A hit or shove: the body's ground velocity changes by (dx, dz) m/s. */
  push(dx: number, dz: number) {
    this.velocity.x += dx;
    this.velocity.z += dz;
  }
}
