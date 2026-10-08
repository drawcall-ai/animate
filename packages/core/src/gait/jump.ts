import { Vector3 } from 'three';
import type { Box } from '../input';
import { clamp, forwardOf, GRAVITY, hypot, leftOf, lerp, minimumJerk, quintic, smoothstep, wrapAngle, yawOf } from '../math';
import { centreOfMass } from '../pose/mass';
import type { Joints } from '../pose/pose';
import type { Proportions } from '../proportions';
import { footYaw, stanceFeet, type Stance } from '../stance';
import type { Gait, Root } from './gait';
import { crossing, type Crossing } from './obstacles';

/** toes behind the near edge at takeoff, heels past the far edge on landing (m, default body) */
const TOE_BACK = 0.07;
const HEEL_PAST = 0.1;
/** ankle-to-ankle spans (× height): a walking step reaches across up to STEP; a standing jump up to REACH */
const SPAN = { step: 0.55, reach: 0.85 };
/** how far short of the takeoff spot the goal leads the walk there instead (m, default body) */
const ARRIVE = 0.5;
/** countermovement: unweighting and braking, then propulsion (s; Linthorne 2001) */
export const LOAD = 0.45;
export const PUSH = 0.25;
/** how far the pelvis lowers (× height), and its upward acceleration at the lowest point, where the legs push hardest (m/s²) */
const DEPTH = 0.16;
export const BOTTOM = 12;
/** the share of LOAD after which the body starts moving forward (its speed builds through the push) */
const SET_OFF = 0.6;
/** the heel's rise at takeoff (rad): the ankles extend last */
export const HEEL_UP = 0.7;
/** takeoff angle of the flight (rad; preferred 31–39°, Wakai & Linthorne 2005) */
const ANGLE = 0.75;
/** trunk lean (rad): at the lowest point, at takeoff, at touchdown, deepest in the landing */
const LEAN = { load: 0.7, takeoff: 0.35, touch: 0.4, absorb: 0.6 };
/** free-arm shoulder flexion added (rad): swung back to the lowest point, forward and up by takeoff, held forward to land */
export const ARMS = { back: -0.9, up: 2.4, land: 1.2 };
/** the arms reverse this long before the lowest point (s): they lead the legs */
export const ARM_LEAD = 0.1;
/** the centre of mass leaves with this share of the pelvis's upward speed: the arms, braking to a stop overhead, hold some back (Lees 2004) */
const ARM_HOLD = 0.93;
/** knee flexion (rad) tucked mid-flight, and reaching down to land (Devita & Skelly 1992: ~20° at contact) */
const FLEX = { tuck: 1.8, reach: 0.4 };
/** the ankles land this far ahead of the hip joints (× height), heel first (rad, toes up) */
const LAND_AHEAD = 0.16;
const STRIKE = 0.25;
/** landing: the pelvis sinks this far (× height), turning back up at its lowest (m/s²), and rises back over RECOVER (s) */
const ABSORB = 0.12;
const TURN = 8;
const RECOVER = 0.5;
/** the speed the body walks off with once over its feet (m/s, default body) */
const WALK_OFF = 0.6;

export type JumpPhase = 'approach' | 'load' | 'push' | 'flight' | 'land' | 'recover';

const _a = new Vector3();
const _b = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _mid = new Vector3();
const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];

/**
 * A standing two-footed jump across a gap a step can't reach (a ditch: a low floor obstacle
 * too wide to step over). The walk stops at the near edge, the body sinks and swings its
 * arms back, then drives up and forward with the arms, flies a ballistic arc with the knees
 * tucked and the legs reaching forward, lands on both heels and sinks to absorb it, and
 * walks on. From the load to the landing it owns the root and the feet: the root carries
 * the posed centre of mass along its flight. Its posture curves (pelvis lift, trunk lean,
 * arm swing) are layered on by the gait overlay and the arms.
 */
export class Jump {
  phase: JumpPhase | null = null;
  /** the obstacle it crosses (from the approach on; the steps leave it to the jump once it owns the feet) */
  over: Box | null = null;
  /** pelvis lift (m), trunk lean (rad) and free-arm shoulder flexion (rad) it adds */
  lift = 0;
  lean = 0;
  arm = 0;
  /** how far the planted heels are raised (rad): the ankles extending through the push-off */
  heel = 0;
  /** time in the phase; from the landing on, since touchdown (s) */
  private t = 0;
  private readonly gap: Crossing = { box: null, enter: 0, exit: 0, dir: new Vector3() };
  /** where the feet take off (their midpoint), the far edge, the direction and facing */
  private readonly takeoff = new Vector3();
  private readonly far = new Vector3();
  private yaw = 0;
  private readonly aimAt: Root = { x: 0, y: 0, z: 0, yaw: 0 };
  /** the run-up: the centre of mass as the body sets off forward, the planned takeoff velocity (m/s) and pelvis lift (m) */
  private readonly base = new Vector3();
  private based = false;
  private vx = 0;
  private vy = 0;
  private up = 0;
  /** the posed centre of mass as last observed and the one before, and the root that posed it */
  private readonly com = new Vector3();
  private readonly lastCom = new Vector3();
  private readonly posedRoot = new Vector3();
  /** the hip joints as last posed [left, right] */
  private readonly hips: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** the flight: its start (centre of mass, velocity), predicted duration, the root's velocity */
  private readonly com0 = new Vector3();
  private readonly v0 = new Vector3();
  private T = 0;
  private readonly rootVel = new Vector3();
  /** where the flight has the centre of mass this tick */
  private readonly at = new Vector3();
  /** per foot: the hip joint at takeoff, the knee's flexion then (rad), the heel-strike ankle it lands at */
  private readonly hip0: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly flex0 = [0, 0];
  private readonly strike: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  /** the feet reached the floor (set as they are posed) */
  private touched = false;
  /** the landing: the root's start and velocity, where it comes to rest over the feet, the durations, the curves' start */
  private readonly land0 = new Vector3();
  private readonly landV = new Vector3();
  private readonly rest = new Vector3();
  private Th = 0;
  private Tv = 0;
  private lift0 = 0;
  private sink = 0;
  private liftV = 0;
  private lean0 = 0;
  private arm0 = 0;

  constructor(
    private d: Proportions,
    private stance: Stance,
  ) {}

  /** the jump owns the root and the feet */
  get owns() {
    return this.phase === 'load' || this.phase === 'push' || this.phase === 'flight' || this.phase === 'land';
  }

  get airborne() {
    return this.phase === 'flight';
  }

  /** no jump */
  end() {
    this.phase = null;
    this.over = null;
    this.lift = this.lean = this.arm = this.heel = 0;
  }

  /**
   * The target to walk to: `target`, or, with a gap to jump on the way, the takeoff spot at
   * its near edge; standing there, the jump begins.
   */
  aim(g: Gait, target: Root): Root {
    // (a gap on the way is seen before the goal crosses it)
    const ahead = g.ahead;
    if (this.phase === null) this.find(g, ahead);
    if (this.phase !== 'approach') return target;
    const dir = this.gap.dir;
    const { takeoff, far } = this;
    // (the goal won't cross after all: no jump)
    if ((ahead.x - far.x) * dir.x + (ahead.z - far.z) * dir.z < 0) {
      this.end();
      return target;
    }
    // standing at the edge, the goal across: go
    const [a, b] = g.feet;
    const settled = a.phase === 'planted' && b.phase === 'planted' && Math.min(a.plantedTime, b.plantedTime) > 0.25;
    const across = (target.x - far.x) * dir.x + (target.z - far.z) * dir.z > 0;
    if (!g.moving && settled && g.speed < 0.05 && across) this.load(g);
    // walking after the goal, then on to the takeoff spot, arriving there at rest
    if ((target.x - takeoff.x) * dir.x + (target.z - takeoff.z) * dir.z < -ARRIVE * g.d.scale) return target;
    return Object.assign(this.aimAt, { x: takeoff.x, y: target.y, z: takeoff.z, yaw: this.yaw });
  }

  /** a gap on the way to `ahead` a step can't cross and a standing jump can: approach it */
  private find(g: Gait, ahead: Vector3) {
    const { d, root } = g;
    _a.set(root.x, 0, root.z);
    const gap = this.gap;
    if (!g.lowObstacles.length || !crossing(g.lowObstacles, _a, ahead, gap)) return;
    const span = gap.exit - gap.enter + d.toeFront + d.heelBack + (TOE_BACK + HEEL_PAST) * d.scale;
    if (span <= SPAN.step * d.height || span > SPAN.reach * d.height) return;
    const dir = gap.dir;
    this.takeoff.copy(dir).multiplyScalar(gap.enter - d.toeFront - TOE_BACK * d.scale).add(_a);
    this.far.copy(dir).multiplyScalar(gap.exit).add(_a);
    this.yaw = yawOf(dir.x, dir.z);
    this.over = gap.box;
    this.phase = 'approach';
  }

  /** standing at the edge: plan the takeoff and start the countermovement */
  private load(g: Gait) {
    const { d } = g;
    const dir = this.gap.dir;
    const [a, b] = g.feet;
    const mid = _mid.addVectors(a.anchor, b.anchor).multiplyScalar(0.5);
    // ankle to ankle: from the feet to past the far edge
    const span = (this.far.x - mid.x) * dir.x + (this.far.z - mid.z) * dir.z + d.heelBack + HEEL_PAST * d.scale;
    // the run-up carries the centre of mass on ahead of the feet by takeoff; the flight the
    // rest of the way, to land the ankles LAND_AHEAD ahead of it (and the hip joints)
    const run = LOAD * (1 - SET_OFF) + PUSH;
    const from = (g.capture.com.x - mid.x) * dir.x + (g.capture.com.z - mid.z) * dir.z;
    // the hip joints at takeoff: up over the balls of the feet, the legs straight, the heels up
    const f = a;
    const heel = f.ankleFor(_b.copy(f.anchor).sub(mid).setY(f.anchor.y), footYaw(this.yaw, f.side, this.stance), -HEEL_UP, _b);
    const touch = touchHeight(g);
    // (the takeoff speed that lands there: by bisection, the longer the run-up the faster)
    let lo = 0;
    let hi = 10;
    for (let i = 0; i < 30; i++) {
      const vx = (this.vx = 0.5 * (lo + hi));
      const ahead = from + 0.5 * vx * run;
      const along = ahead - (heel.x * dir.x + heel.z * dir.z);
      const hipY = heel.y + Math.sqrt(Math.max(0, (0.995 * d.legLength) ** 2 - along * along));
      this.up = hipY - (d.hipHeight + d.offsets.leftUpperLeg.y);
      this.vy = vx * Math.tan(ANGLE);
      if (ahead + vx * fallTime(ARM_HOLD * this.vy, hipY - touch) > span - LAND_AHEAD * d.height) hi = vx;
      else lo = vx;
    }
    this.based = false;
    this.phase = 'load';
    this.t = 0;
  }

  /** Advance a jump that owns the root; false when it doesn't (the gait walks). */
  update(g: Gait, dt: number): boolean {
    if (this.phase === null || this.phase === 'approach') return false;
    const { root } = g;
    this.lastCom.copy(this.com);
    this.com.copy(g.capture.com);
    this.posedRoot.set(root.x, root.y, root.z);
    this.t += dt;
    if (this.phase === 'load' && this.t >= LOAD) {
      this.phase = 'push';
      this.t -= LOAD;
    }
    if (this.phase === 'push' && this.t >= PUSH) this.takeOff(g, dt);
    if (this.phase === 'flight' && this.touched) this.touchDown(g, dt);
    if (this.phase === 'land' && this.t >= this.Th) this.walkOff(g);
    if (this.phase === 'recover' && this.t >= this.Tv + RECOVER) {
      this.end();
      return false;
    }
    if (this.phase === 'load' || this.phase === 'push') this.runUp(g);
    if (this.phase === 'flight') this.fly(g, dt);
    if (this.phase === 'land') this.brake(g);
    this.curves();
    return this.owns;
  }

  /**
   * the root through the countermovement: still, then carrying the centre of mass forward,
   * speeding up into the takeoff
   */
  private runUp(g: Gait) {
    const run = LOAD * (1 - SET_OFF) + PUSH;
    const t = (this.phase === 'push' ? LOAD + this.t : this.t) - LOAD * SET_OFF;
    if (t < 0) return;
    // (from where the centre of mass is as it sets off)
    if (!this.based) this.base.copy(this.com);
    this.based = true;
    const s = quintic(0, 0, 0, 0.5 * this.vx * run, this.vx, 0, run, t);
    const dir = this.gap.dir;
    g.root.x = this.base.x + dir.x * s - (this.com.x - this.posedRoot.x);
    g.root.z = this.base.z + dir.z * s - (this.com.z - this.posedRoot.z);
  }

  /** leaving the floor: the flight starts from the posed centre of mass as it moves, and is planned to land the feet on their heels */
  private takeOff(g: Gait, dt: number) {
    const { d } = g;
    this.com0.copy(this.com);
    this.v0.subVectors(this.com, this.lastCom).divideScalar(dt);
    const hipY = 0.5 * (this.hips[0].y + this.hips[1].y);
    this.T = fallTime(this.v0.y, hipY - touchHeight(g));
    const T = this.T;
    // where the hip joints come down, and the feet ahead of them
    const fwd = forwardOf(this.yaw, _f);
    const cx = 0.5 * (this.hips[0].x + this.hips[1].x) + this.v0.x * T + fwd.x * LAND_AHEAD * d.height;
    const cz = 0.5 * (this.hips[0].z + this.hips[1].z) + this.v0.z * T + fwd.z * LAND_AHEAD * d.height;
    stanceFeet(cx, cz, fwd, leftOf(this.yaw, _l), d, this.stance, _homes);
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const w = f.swing;
      f.phase = 'swing';
      w.s = 0;
      w.duration = T;
      w.lift = w.clear = w.over = 0;
      w.pace = Infinity;
      w.from.copy(f.pose.ankle);
      w.fromYaw = f.yaw;
      w.to.copy(_homes[s]);
      w.toYaw = footYaw(this.yaw, f.side, this.stance);
      w.strikePitch = STRIKE;
      f.ankleFor(w.to, w.toYaw, STRIKE, this.strike[s]);
      this.hip0[s].copy(this.hips[s]);
      this.flex0[s] = 2 * Math.acos(Math.min(1, this.hips[s].distanceTo(f.pose.ankle) / d.legLength));
    }
    this.touched = false;
    this.phase = 'flight';
    // (this tick is `dt` after the pose it starts from)
    this.t = dt;
  }

  /** the centre of mass flies its parabola: the root carries the pose along it */
  private fly(g: Gait, dt: number) {
    const { root } = g;
    const t = this.t;
    const c = _a.copy(this.com0).addScaledVector(this.v0, t);
    c.y -= 0.5 * GRAVITY * t * t;
    this.at.copy(c);
    // (the pose's centre of mass off its root as last posed; `carry` puts it there exactly)
    const off = _b.subVectors(this.com, this.posedRoot);
    const x = c.x - off.x;
    const y = c.y - off.y;
    const z = c.z - off.z;
    this.rootVel.set((x - root.x) / dt, (y - root.y) / dt, (z - root.z) / dt);
    root.x = x;
    root.y = y;
    root.z = z;
  }

  /** both feet down: the legs take the body's weight and speed */
  private touchDown(g: Gait, dt: number) {
    const { d, root } = g;
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      f.phase = 'planted';
      // (the flat foot under the heel-strike ankle where it came down)
      const at = f.ankleFor(_a.set(0, d.ankleHeight, 0), f.swing.toYaw, STRIKE, _a);
      f.anchor.set(f.pose.ankle.x - at.x, d.ankleHeight, f.pose.ankle.z - at.z);
      f.yaw = f.swing.toYaw;
      f.landPitch = f.pose.pitch = STRIKE;
      f.plantedTime = 0;
    }
    g.lastLanded = 1;
    const dir = this.gap.dir;
    this.land0.set(root.x, 0, root.z);
    this.landV.set(this.rootVel.x, 0, this.rootVel.z);
    this.lift0 = this.lift + root.y;
    this.liftV = this.rootVel.y;
    root.y = 0;
    // the root comes to rest over the feet, moving on at a walk
    const [a, b] = g.feet;
    this.rest.addVectors(a.anchor, b.anchor).multiplyScalar(0.5).setY(0);
    const dist = Math.max(0, (this.rest.x - root.x) * dir.x + (this.rest.z - root.z) * dir.z);
    const v = this.landV.x * dir.x + this.landV.z * dir.z;
    this.Th = clamp((2 * dist) / (v + WALK_OFF * d.scale), 0.15, 0.45);
    // (sinking on at least a little from where the feet came down)
    this.sink = Math.min(-ABSORB * d.height, this.lift0 - 0.04 * d.height);
    this.Tv = clamp((2 * (this.lift0 - this.sink)) / Math.max(0.5, -this.liftV), 0.1, 0.2);
    this.lean0 = this.lean;
    this.arm0 = this.arm;
    this.phase = 'land';
    // (this tick is `dt` after the pose that touched down)
    this.t = dt;
  }

  /** the landing brakes the root to a walk over the feet */
  private brake(g: Gait) {
    const dir = this.gap.dir;
    const v = WALK_OFF * g.d.scale;
    g.root.x = quintic(this.land0.x, this.landV.x, 0, this.rest.x, dir.x * v, 0, this.Th, this.t);
    g.root.z = quintic(this.land0.z, this.landV.z, 0, this.rest.z, dir.z * v, 0, this.Th, this.t);
  }

  /** over the feet: the gait walks on */
  private walkOff(g: Gait) {
    const dir = this.gap.dir;
    const v = WALK_OFF * g.d.scale;
    g.velocity.set(dir.x * v, 0, dir.z * v);
    g.moving = true;
    this.over = null;
    this.phase = 'recover';
  }

  /** the posture: the pelvis's lift, the trunk's lean and the arms' swing through the phases */
  private curves() {
    const H = this.d.height;
    const t = this.t;
    switch (this.phase) {
      case 'load':
      case 'push': {
        const load = this.phase === 'load';
        const ta = load ? t : LOAD + t;
        this.lift = load ? quintic(0, 0, 0, -DEPTH * H, 0, BOTTOM, LOAD, t) : quintic(-DEPTH * H, 0, BOTTOM, this.up, this.vy, -GRAVITY, PUSH, t);
        this.lean = load ? LEAN.load * minimumJerk(t / LOAD) : lerp(LEAN.load, LEAN.takeoff, minimumJerk(t / PUSH));
        // (the ankles extend last: hips, knees, then ankles)
        this.heel = load ? 0 : HEEL_UP * smoothstep(0.2, 1, t / PUSH) ** 2;
        const turn = LOAD - ARM_LEAD;
        this.arm = ta < turn ? ARMS.back * minimumJerk(ta / turn) : lerp(ARMS.back, ARMS.up, minimumJerk((ta - turn) / (LOAD + PUSH - turn)));
        return;
      }
      case 'flight': {
        const e = t / this.T;
        this.heel = 0;
        this.lean = lerp(LEAN.takeoff, LEAN.touch, minimumJerk(e));
        this.arm = lerp(ARMS.up, ARMS.land, minimumJerk(e));
        return;
      }
      case 'land':
      case 'recover': {
        const { Tv } = this;
        const down = t < Tv;
        this.lift = down ? quintic(this.lift0, this.liftV, 0, this.sink, 0, TURN, Tv, t) : quintic(this.sink, 0, TURN, 0, 0, 0, RECOVER, t - Tv);
        this.lean = down ? lerp(this.lean0, LEAN.absorb, minimumJerk(t / Tv)) : LEAN.absorb * (1 - minimumJerk((t - Tv) / RECOVER));
        this.arm = this.arm0 * (1 - minimumJerk(t / (Tv + 0.8 * RECOVER)));
        return;
      }
    }
  }

  /**
   * In flight, how far the posed body (`joints`) has to move for its centre of mass to be
   * where the flight has it, into `out` (the root and the feet move with it); false on the ground.
   */
  carry(g: Gait, joints: Joints, out: Vector3): boolean {
    if (this.phase !== 'flight') return false;
    out.subVectors(this.at, centreOfMass(joints, _a));
    g.root.x += out.x;
    g.root.y += out.y;
    g.root.z += out.z;
    for (const f of g.feet) f.pose.ankle.add(out);
    return true;
  }

  /**
   * The hip joints as posed this tick ([left, right]); in flight the feet hang from them:
   * the legs tuck, then reach down and forward to where they land, on their heels.
   */
  pose(g: Gait, hips: readonly [Vector3, Vector3]) {
    this.hips[0].copy(hips[0]);
    this.hips[1].copy(hips[1]);
    if (this.phase !== 'flight') return;
    const { d } = g;
    const T = this.T;
    const e = this.t / T;
    const q = minimumJerk(this.t / (0.9 * T));
    // (carried with the body early on, then set down where the landing was planned)
    const planted = smoothstep(0.55, 0.9, e);
    const k = e < 0.45 ? 0 : 1;
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const w = f.swing;
      const hip = hips[s];
      const end = this.strike[s];
      const h0 = this.hip0[s];
      // the ankle's way relative to the hip joint: from takeoff to landing (the hips as predicted then)
      const rx = lerp(w.from.x - h0.x, end.x - (h0.x + this.v0.x * T), q);
      const rz = lerp(w.from.z - h0.z, end.z - (h0.z + this.v0.z * T), q);
      const x = lerp(hip.x + rx, end.x, planted);
      const z = lerp(hip.z + rz, end.z, planted);
      // (bending the knee: the leg's length follows its flexion, cos(flex / 2))
      const flex = k === 0 ? lerp(this.flex0[s], FLEX.tuck, minimumJerk(e / 0.45)) : lerp(FLEX.tuck, FLEX.reach, minimumJerk((e - 0.45) / 0.4));
      const leg = Math.cos(flex / 2) * d.legLength;
      const across = hypot(x - hip.x, z - hip.z);
      let y = hip.y - Math.sqrt(Math.max(0, leg * leg - across * across));
      if (y <= end.y && e > 0.5) {
        y = end.y;
        this.touched = true;
      }
      f.pose.ankle.set(x, y, z);
      f.yaw = w.fromYaw + wrapAngle(w.toYaw - w.fromYaw) * q;
      w.s = Math.min(1, e);
    }
  }
}

/** how high the hip joints are as the feet touch down: the legs reaching forward, the heels on the floor (m) */
function touchHeight(g: Gait): number {
  const { d } = g;
  const strike = g.feet[0].ankleFor(_a.set(0, d.ankleHeight, 0), 0, STRIKE, _a).y;
  return strike + Math.sqrt((Math.cos(FLEX.reach / 2) * d.legLength) ** 2 - (LAND_AHEAD * d.height) ** 2);
}

/** how long a body rising at `vy` (m/s) takes to come down `drop` m below where it started (s) */
function fallTime(vy: number, drop: number): number {
  return (vy + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, drop))) / GRAVITY;
}
