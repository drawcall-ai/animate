import { Quaternion, Vector3 } from 'three';
import type { BodyDimensions } from './body';
import { clamp, forwardOf, lerp, minimumJerk, quatYXZ, smoothstep, softMin, wrapAngle, yawOf } from './math';
import { stanceFeet, type Obstacle, type Stance, type Task } from './posture';

export type FootPhase = 'planted' | 'swing' | 'lifted';

/** Foot contact geometry, all offsets in the foot frame relative to the ankle. */
export class Foot {
  phase: FootPhase = 'planted';
  /** flat-foot ankle position of the current (or next) support placement */
  readonly anchor = new Vector3();
  yaw = 0;
  /** + = toes up (dorsiflexion at heel strike), − = heel raised */
  pitch = 0;
  pivot: 'heel' | 'ball' = 'heel';
  plantedTime = 10;
  landPitch = 0;

  // swing state
  s = 0;
  duration = 0.4;
  lift = 0.08;
  /** ankle height this swing must clear at its apex (0: nothing to step over) */
  clear = 0;
  /** swing progress over which the foot passes above the obstacle */
  overOn = 0;
  overOff = 1;
  /** body speed this step carries (m/s): one step per step time (Infinity: not limited) */
  pace = Infinity;
  readonly from = new Vector3();
  /** ankle velocity at lift-off: the swing continues it (no knee snap at toe-off) */
  readonly fromVel = new Vector3();
  /** last resolved ankle, to know how the foot was moving */
  readonly prevAnkle = new Vector3();
  fromYaw = 0;
  fromPitch = 0;
  readonly to = new Vector3();
  toYaw = 0;
  hsPitch = 0;
  liftWeight = 0;
  /** support-foot yaw before a kick pivot */
  pivotBase = 0;

  /** resolved ankle before leg IK */
  readonly ankle = new Vector3();
  readonly q = new Quaternion();

  constructor(
    readonly side: 1 | -1,
    private d: BodyDimensions,
  ) {}

  /** local contact points */
  heelLocal(out: Vector3) {
    return out.set(0, -this.d.ankleHeight, -this.d.heelBack);
  }
  ballLocal(out: Vector3) {
    return out.set(0, -this.d.ankleHeight, this.d.ballFront);
  }
  toeLocal(out: Vector3) {
    return out.set(0, -this.d.ankleHeight * 0.85, this.d.toeFront);
  }

  /** Ankle position for a flat anchor rotated by `pitch` about the heel (pitch > 0) or ball (pitch < 0). */
  ankleFor(anchor: Vector3, yaw: number, pitch: number, out: Vector3): Vector3 {
    const pivotLocal = pitch >= 0 ? this.heelLocal(_a) : this.ballLocal(_a);
    quatYXZ(yaw, 0, 0, _q);
    const pivotWorld = _b.copy(pivotLocal).applyQuaternion(_q).add(anchor);
    quatYXZ(yaw, -pitch, 0, _q);
    return out.copy(pivotLocal).applyQuaternion(_q).negate().add(pivotWorld);
  }

  updateOrientation() {
    quatYXZ(this.yaw, -this.pitch, 0, this.q);
  }
}

/** s^1.5 (1-s)^2.5, normalised to peak 1 at s = 0.375 */
function swingHump(s: number): number {
  const t = clamp(s, 0, 1);
  return (Math.pow(t, 1.5) * Math.pow(1 - t, 2.5)) / 0.07093;
}

const _a = new Vector3();
const _b = new Vector3();
const _v = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _homes: [Vector3, Vector3] = [new Vector3(), new Vector3()];

export interface GaitOptions {
  maxSpeed: number;
  accel: number;
  turnRate: number;
}

export interface Root {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Root locomotion + event-driven stepping. The root is a continuous "where my
 * body is" point that approaches the planner's target; the feet are
 * discrete supports that step to stay under it (Raibert-style placement).
 */
export class Gait {
  readonly root: Root = { x: 0, z: 0, yaw: 0 };
  readonly velocity = new Vector3();
  readonly feet: [Foot, Foot];
  moving = false;
  /** 0..1 smoothed "walking" amount */
  walk = 0;
  lastStep = 1;
  private goalYaw = 0;
  private target: Root = { x: 0, z: 0, yaw: 0 };
  private targetVel = new Vector3();
  /** 1 = turn to face the travel direction when walking somewhere (0 for e.g. fighters) */
  faceTravel = 1;
  /** per-frame override: 0 when a gaze/head orientation dictates facing */
  faceTravelNow = 1;
  /** deep crouch: no idle adjustment steps */
  crouched = false;
  /** a walk has just been started and no foot has lifted yet */
  private starting = false;
  /** follow the goal closely (tracked head): start/stop moving on small offsets */
  eager = false;
  /** a tracked pelvis/torso/head sets the pace: allow catching up faster than a self-paced walk */
  speedCap = Infinity;
  /** obstacles; those with a `height` are stepped over (swing clears them, feet never land on them) */
  obstacles: Obstacle[] = [];

  constructor(
    private d: BodyDimensions,
    readonly opts: GaitOptions,
  ) {
    this.feet = [new Foot(1, d), new Foot(-1, d)];
  }

  reset(x: number, z: number, yaw: number, stance: Stance) {
    Object.assign(this.root, { x, z, yaw });
    Object.assign(this.target, { x, z, yaw });
    this.goalYaw = yaw;
    this.velocity.set(0, 0, 0);
    this.targetVel.set(0, 0, 0);
    this.moving = false;
    this.walk = 0;
    stanceFeet(x, z, yaw, this.d, stance, _homes);
    for (let s = 0; s < 2; s++) {
      const f = this.feet[s];
      f.phase = 'planted';
      f.anchor.copy(_homes[s]);
      f.yaw = yaw + stance.turn + f.side * stance.toeOut;
      f.pitch = 0;
      f.plantedTime = 10;
      f.ankle.copy(f.anchor);
    }
  }

  private get maxSpeed() {
    // a step planned around an obstacle sets the pace: the body travels one step per
    // step time (shortened / high, slow steps slow it — it can't outrun its feet)
    let pace = Infinity;
    for (const f of this.feet) if (f.phase === 'swing') pace = Math.min(pace, f.pace);
    return Math.min(this.speedCap, this.opts.maxSpeed, pace);
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** step timing for the current speed */
  timing() {
    const H = this.d.height;
    // walk ratio (step length / cadence) ≈ 0.0065 m·min/step for a 1.75 m adult
    const walkRatio = 0.0056 * (H / 1.75);
    let cadence = Math.max(1.15, Math.sqrt((60 * this.speed) / walkRatio) / 60); // steps / s
    // sideways / backward steps are short, so the same speed needs a quicker rhythm
    if (this.speed > 0.05) {
      const f = forwardOf(this.root.yaw, _b);
      const along = (this.velocity.x * f.x + this.velocity.z * f.z) / this.speed;
      const stepMax = (along > 0 ? lerp(0.32, 0.75, along) : lerp(0.32, 0.4, -along)) * (H / 1.75);
      cadence = Math.max(cadence, this.speed / stepMax);
    }
    cadence = Math.min(cadence, 2.6);
    const stepT = 1 / cadence;
    const swing = clamp(0.8 * stepT, 0.3, 0.5);
    // ~10% of the stride per double-support phase; never a long pause between steps
    // (side-shuffles barely pause at all)
    let lateral = 0;
    if (this.speed > 0.05) {
      const vl = this.velocity.x * Math.cos(this.root.yaw) - this.velocity.z * Math.sin(this.root.yaw);
      lateral = Math.abs(vl) / this.speed;
    }
    const doubleSupport = clamp(0.2 * stepT, 0.06, 0.14) * (1 - 0.6 * smoothstep(0.5, 0.9, lateral));
    // running: short ground contacts and a flight phase; the swing is longer than a step
    const run = this.run;
    if (run <= 0) return { stepT, swing, doubleSupport, stance: stepT + doubleSupport, run };
    const v = this.speed;
    const runCadence = clamp(2.6 + 0.15 * (v - 2.5), 2.5, 3.2) * Math.sqrt(1.75 / H);
    const runStep = 1 / runCadence;
    const runStance = clamp(0.75 / v + 0.02, 0.18, 0.32);
    const runSwing = 2 * runStep - runStance;
    return {
      stepT: lerp(stepT, runStep, run),
      swing: lerp(swing, runSwing, run),
      doubleSupport,
      stance: lerp(stepT + doubleSupport, runStance, run),
      run,
    };
  }

  /** 0 = walking, 1 = running (by speed, ~2.0–2.5 m/s transition) */
  get run() {
    return smoothstep(1.9, 2.5, this.speed * Math.sqrt(1.75 / this.d.height));
  }

  /** how far ahead a new step's landing is predicted */
  private leadTime(t: ReturnType<Gait['timing']>, swingLeft: number) {
    return lerp(swingLeft + 0.5 * t.swing * 1.5 * 0.9, swingLeft + 0.5 * t.stance, t.run);
  }

  private stanceRef!: Stance;

  private lastDt = 1 / 60;
  private clock = 0;
  private lastLift = 1;
  private lastLiftAt = -10;

  update(dt: number, target: Root, stance: Stance, liftTasks: [Task | null, Task | null]) {
    this.stanceRef = stance;
    this.lastDt = dt;
    this.clock += dt;
    this.updateRoot(dt, target);
    this.updateFeet(dt, stance, liftTasks);
  }

  private updateRoot(dt: number, target: Root) {
    const { root, velocity: vel, opts } = this;
    // target velocity (feed-forward) so moving targets are tracked without lag
    if (dt > 0) {
      const k = 1 - Math.exp(-9 * dt);
      const jx = target.x - this.target.x;
      const jz = target.z - this.target.z;
      // only continuous goal motion counts as velocity; a re-planned (jumping) goal doesn't
      const jump = Math.hypot(jx, jz) > 4 * dt;
      const tvx = jump ? 0 : jx / dt;
      const tvz = jump ? 0 : jz / dt;
      this.targetVel.x += (tvx - this.targetVel.x) * k;
      this.targetVel.z += (tvz - this.targetVel.z) * k;
    }
    this.target = { ...target };
    const dx = target.x - root.x;
    const dz = target.z - root.z;
    const dist = Math.hypot(dx, dz);
    const yawErr = wrapAngle(target.yaw - root.yaw);
    const tvl = Math.hypot(this.targetVel.x, this.targetVel.z);

    const startDist = (this.eager ? 0.05 : 0.14) * (this.d.height / 1.75);
    if (!this.moving && (dist > startDist || Math.abs(yawErr) > 0.45 || tvl > (this.eager ? 0.1 : 0.25))) {
      this.moving = true;
      // gait initiation: the first step goes at once, the body falls into it
      // (not from a crouch: that's a reposition, handled with care)
      this.starting = !this.crouched;
    }
    if (this.starting && this.feet.some((f) => f.phase !== 'planted')) this.starting = false;

    if (this.moving) {
      const catchUp = Math.min(this.maxSpeed, Math.sqrt(2 * opts.accel * 0.8 * dist), 2.5 * dist + 0.4 * Math.sqrt(dist));
      const kk = dist > 1e-6 ? catchUp / dist : 0;
      let vdx = this.targetVel.x + dx * kk;
      let vdz = this.targetVel.z + dz * kk;
      // brake to arrive: speed toward the goal beyond what the goal itself does is
      // limited by the stopping distance
      if (dist > 1e-6) {
        const ux = dx / dist,
          uz = dz / dist;
        const along = vdx * ux + vdz * uz;
        const cap = Math.max(0, this.targetVel.x * ux + this.targetVel.z * uz) + Math.sqrt(2 * 2.2 * opts.accel * 0.8 * dist);
        if (along > cap) {
          vdx -= (along - cap) * ux;
          vdz -= (along - cap) * uz;
        }
      }
      // until the first foot is off the ground the body barely glides (no hips-first start)
      const cap = this.starting ? 0.15 : this.maxSpeed;
      const vdl = Math.hypot(vdx, vdz);
      if (vdl > cap) {
        vdx *= cap / vdl;
        vdz *= cap / vdl;
      } else if (vdl > this.maxSpeed) {
        vdx *= this.maxSpeed / vdl;
        vdz *= this.maxSpeed / vdl;
      }
      const dvx = vdx - vel.x;
      const dvz = vdz - vel.z;
      const dvl = Math.hypot(dvx, dvz);
      // people brake harder than they accelerate
      const braking = vdx * vel.x + vdz * vel.z < vel.x * vel.x + vel.z * vel.z;
      const maxDv = (braking ? 2.2 * opts.accel : opts.accel) * dt;
      const s = dvl > maxDv ? maxDv / dvl : 1;
      vel.x += dvx * s;
      vel.z += dvz * s;
      root.x += vel.x * dt;
      root.z += vel.z * dt;
      this.leashToFeet();

      // walk facing the travel direction when going somewhere, else face the task
      const speed = this.speed;
      const travelYaw = yawOf(vel.x, vel.z);
      // people only back up for a short, slow shuffle; anything longer they walk facing
      // the way they go and turn around on arrival
      const backwards = Math.abs(wrapAngle(travelYaw - target.yaw)) > 2.2 && dist < 0.6 && speed < 0.6;
      // keep facing the way you go while moving; turn to the goal facing as you slow to a stop
      // (turning around at speed places the feet behind the falling body)
      const going = Math.max(smoothstep(0.25, 0.6, dist), smoothstep(0.5, 0.9, tvl));
      const far = going * smoothstep(0.35, 0.8, speed) * (backwards ? 0 : 1) * this.faceTravel * this.faceTravelNow;
      this.goalYaw = target.yaw + wrapAngle(travelYaw - target.yaw) * far;
      const e = wrapAngle(this.goalYaw - root.yaw);
      const turn = clamp(e * 5 * dt, -opts.turnRate * dt, opts.turnRate * dt);
      root.yaw += this.twistLimit(turn);

      if (dist < 0.05 && speed < 0.15 && tvl < 0.08 && Math.abs(yawErr) < 0.1) {
        this.moving = false;
        this.starting = false;
        vel.set(0, 0, 0);
      }
    } else {
      // (a push while standing still carries the body a little, then the feet catch it)
      root.x += vel.x * dt;
      root.z += vel.z * dt;
      vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
      this.leashToFeet();
      this.goalYaw = root.yaw;
    }
    const walkTarget = smoothstep(0.08, 0.6, this.speed);
    this.walk += (walkTarget - this.walk) * Math.min(1, dt * 6);
  }

  /**
   * The body can only twist so far over its feet (hip rotation, ~25°): turning further
   * waits for a step. The feet's heading is that of the planted feet, and of where a
   * swinging foot is landing. Returns the part of `turn` that's allowed (never pulls back).
   */
  private twistLimit(turn: number): number {
    const { root, feet } = this;
    let sx = 0,
      sz = 0;
    for (const f of feet) {
      const y = (f.phase === 'swing' ? f.toYaw : f.yaw) - this.stanceRef.turn - f.side * this.stanceRef.toeOut;
      sx += Math.sin(y);
      sz += Math.cos(y);
    }
    const feetYaw = Math.atan2(sx, sz);
    const d = wrapAngle(root.yaw + turn - feetYaw);
    const max = 0.45;
    return Math.abs(d) > max && Math.sign(turn) === Math.sign(d) ? 0 : turn;
  }

  /**
   * The body can't outrun its feet: keep the root within reach of the support
   * (planted anchors, or where a swinging foot is about to land).
   */
  private leashToFeet() {
    const { root, velocity: vel, feet } = this;
    // sideways only (forward walking has its own Raibert rhythm): the body stays
    // within the lateral span of its footholds — planted, or where a swing lands.
    // "Sideways" is judged against the facing the body is turning to, not its current
    // one: mid-turn (walking up, then turning around to sit) the travel would otherwise
    // read as sideways and be braked into a drift
    const lx = Math.cos(this.goalYaw),
      lz = -Math.sin(this.goalYaw);
    let lo = Infinity,
      hi = -Infinity;
    for (const f of feet) {
      const p = f.phase === 'swing' ? _c.lerpVectors(f.anchor, f.to, smoothstep(0, 1, f.s)) : f.anchor;
      const l = (p.x - root.x) * lx + (p.z - root.z) * lz;
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    // (a shuffling body travels a little past the closing feet)
    const vlat = Math.abs(vel.x * lx + vel.z * lz);
    const margin = (0.05 + 0.08 * smoothstep(0.1, 0.4, vlat)) * (this.d.height / 1.75);
    const shift = lo > margin ? lo - margin : hi < -margin ? hi + margin : 0;
    if (shift === 0) return;
    // steer the body's sideways velocity back over its feet (smooth: no position jumps)
    const v = vel.x * lx + vel.z * lz;
    const want = clamp(shift * 4, -0.6, 0.6);
    const dv = (want - v) * Math.min(1, 10 * this.lastDt);
    if (Math.sign(dv) === Math.sign(shift)) {
      vel.x += dv * lx;
      vel.z += dv * lz;
    }
  }

  /** flat-foot target placement for a foot, predicted `lead` seconds ahead */
  private desiredAnchor(s: number, lead: number, stance: Stance, out: Vector3): number {
    const { root, velocity: vel, target } = this;
    let px = vel.x * lead;
    let pz = vel.z * lead;
    const toT = Math.hypot(target.x - root.x, target.z - root.z) + Math.hypot(this.targetVel.x, this.targetVel.z) * lead;
    const pl = Math.hypot(px, pz);
    if (pl > toT && pl > 1e-6) {
      px *= toT / pl;
      pz *= toT / pl;
    }
    if (this.starting) {
      const gx = target.x - root.x,
        gz = target.z - root.z;
      const gl = Math.hypot(gx, gz);
      // (setting off roughly forward; sideways/diagonal starts use need-based stepping)
      const fwdness = gl > 1e-6 ? (gx * Math.sin(root.yaw) + gz * Math.cos(root.yaw)) / gl : 0;
      if (gl > 1e-6 && fwdness > 0.7) {
        // a moving goal (someone setting off) gets a proper first step, a small
        // reposition just what it needs
        const going = Math.hypot(this.targetVel.x, this.targetVel.z) > 0.04 || gl > 0.3;
        const k = (going ? 0.32 * (this.d.height / 1.75) : Math.min(gl, 0.32 * (this.d.height / 1.75))) / gl;
        px = gx * k;
        pz = gz * k;
      }
    }
    // side-steps aim at where the body has to go, not just where it's drifting
    // (otherwise a lagging root makes short steps, which keep it lagging)
    if (lead > 0) {
      const lx = Math.cos(root.yaw),
        lz = -Math.sin(root.yaw);
      const need = (target.x - root.x) * lx + (target.z - root.z) * lz;
      const have = px * lx + pz * lz;
      const want = clamp(need * 0.9, -0.45, 0.45);
      if (Math.abs(want) > Math.abs(have) && Math.sign(want) === Math.sign(need)) {
        px += (want - have) * lx;
        pz += (want - have) * lz;
      }
    }
    const yawPred = root.yaw + clamp(wrapAngle(this.goalYaw - root.yaw), -1.2, 1.2) * clamp(lead * 2.5, 0, 1);
    const walkNarrow = this.walk * (stance.stagger === 0 ? 1 : 0.3);
    const width = lerp(stance.width, Math.min(stance.width, 0.036 * this.d.height), walkNarrow);
    stanceFeet(root.x + px, root.z + pz, yawPred, this.d, { ...stance, width }, _homes);
    out.copy(_homes[s]);
    return yawPred + stance.turn + this.feet[s].side * stance.toeOut;
  }

  private updateFeet(dt: number, stance: Stance, liftTasks: [Task | null, Task | null]) {
    const { feet } = this;
    const t = this.timing();
    const speedN = this.speed;

    for (const f of feet) if (f.phase === 'planted') f.plantedTime += dt;

    // lifted (kicking) feet
    for (let s = 0; s < 2; s++) {
      const f = feet[s];
      const task = liftTasks[s];
      const w = task ? clamp(task.weight, 0, 1) : 0;
      if (w > 0 && f.phase === 'planted' && feet[1 - s].phase === 'planted') {
        f.phase = 'lifted';
        feet[1 - s].pivotBase = feet[1 - s].yaw;
      }
      if (f.phase === 'lifted') {
        f.liftWeight = w;
        // the support foot pivots on its ball, more for kicks that go around the side
        const sup = feet[1 - s];
        if (task) {
          const rx = task.pos.x - this.root.x;
          const rz = task.pos.z - this.root.z;
          const hl = Math.hypot(rx, rz) || 1;
          const lat = Math.abs(rx * Math.cos(this.root.yaw) - rz * Math.sin(this.root.yaw)) / hl;
          sup.yaw = sup.pivotBase + f.side * (0.3 + 1.1 * lat) * w * smoothstep(0.2, 0.6, task.pos.y / this.d.height);
        }
        if (w <= 0) {
          sup.yaw = sup.pivotBase;
          f.phase = 'planted';
          f.plantedTime = 0;
          f.landPitch = 0;
          f.pitch = 0;
        } else {
          f.ankle.copy(f.anchor).lerp(task!.pos, w);
          f.ankle.y += 0.12 * this.d.height * Math.sin(Math.PI * w) * 0.5 * (1 - w);
          f.pitch = -0.55 * w;
        }
      }
    }
    const anyLifted = feet.some((f) => f.phase === 'lifted');
    const swinging = feet.findIndex((f) => f.phase === 'swing');

    // ---- running: each foot pushes off after a short contact, even while the other
    // is still in the air (flight phase)
    // a step clock: each foot pushes off half a stride after the other did, so the
    // rhythm stays locked to the speed (no drifting, no hopping in sync)
    if (t.run > 0.5 && !anyLifted) {
      const s = 1 - this.lastLift;
      const f = feet[s];
      if (f.phase === 'planted' && this.clock - this.lastLiftAt >= t.stepT && f.plantedTime >= 0.6 * t.stance) {
        this.startSwing(s, t.swing, stance);
      }
    }

    // ---- trigger a new step
    if (swinging < 0 && !anyLifted && t.run <= 0.5) {
      const errs = [0, 0];
      const yawErrs = [0, 0];
      const lead = this.moving ? this.leadTime(t, t.swing) : 0;
      for (let s = 0; s < 2; s++) {
        const yaw = this.desiredAnchor(s, lead, stance, _v);
        errs[s] = Math.hypot(_v.x - feet[s].anchor.x, _v.z - feet[s].anchor.z);
        yawErrs[s] = Math.abs(wrapAngle(yaw - feet[s].yaw));
      }
      let pick = -1;
      // a foot left far behind (or ahead) must step regardless of rhythm
      const maxDev = 0.42 * this.d.height;
      for (let s = 0; s < 2; s++) {
        const dx = feet[s].anchor.x - this.root.x;
        const dz = feet[s].anchor.z - this.root.z;
        if (Math.hypot(dx, dz) > maxDev && feet[1 - s].plantedTime > 0.05) pick = s;
      }
      if (pick >= 0) {
        // fall through to startSwing below
      } else if (this.moving || speedN > 0.05) {
        // alternate by default, but the foot that needs it most (and can make
        // progress) leads: side-steps lead with the foot on that side
        const score = (s: number) => errs[s] + 0.25 * yawErrs[s];
        const progress = (s: number) => {
          this.desiredAnchor(s, lead, stance, _v);
          this.limitStep(s, _v, this.desiredAnchor(s, lead, stance, _v));
          return Math.hypot(_v.x - feet[s].anchor.x, _v.z - feet[s].anchor.z);
        };
        let last = this.lastStep;
        // setting off: the foot on the side of the goal leads (no stepping across)
        if (feet[0].plantedTime > 0.3 && feet[1].plantedTime > 0.3) {
          const gx = this.target.x - this.root.x,
            gz = this.target.z - this.root.z;
          const gl = Math.hypot(gx, gz);
          const gLat = gx * Math.cos(this.root.yaw) - gz * Math.sin(this.root.yaw);
          if (gl > 0.02 && Math.abs(gLat) > 0.3 * gl) last = gLat > 0 ? 1 : 0;
        }
        const next = 1 - last;
        const lastLoaded = feet[last].plantedTime >= t.doubleSupport;
        if (this.starting && lastLoaded && feet[next].plantedTime >= t.doubleSupport && progress(next) >= 0.1) pick = next;
        // slow repositioning: only steps that are worth a step
        const minMove = this.speed < 0.3 ? 0.05 : 0.02;
        // and nobody walks in a deep squat unless a foot is badly out of place
        const squatHold = this.crouched && this.speed < 0.35 && Math.max(errs[0], errs[1]) < 0.3;
        if (pick < 0 && !squatHold && lastLoaded && score(next) > (this.speed < 0.3 ? 0.06 : 0.03)) {
          const lastInstead =
            feet[next].plantedTime >= t.doubleSupport &&
            score(last) > 0.03 &&
            progress(last) >= minMove &&
            (progress(next) < minMove || score(last) > 1.5 * score(next) + 0.03);
          if (lastInstead) pick = last;
          else if (progress(next) >= minMove) pick = next;
        }
      } else {
        // crouched: skip fussy adjustments, but a foot left far behind must still follow
        const k = this.crouched && Math.max(errs[0], errs[1]) < 0.3 ? 5 : 1;
        const score = (s: number) => Math.max(errs[s] / (0.1 * k), yawErrs[s] / (0.45 * k));
        const best = score(0) >= score(1) ? 0 : 1;
        if (score(best) > 1 && feet[1 - best].plantedTime > 0.12) pick = best;
        // finish the pair: bring the other foot alongside after an adjustment
        else if (k === 1 && feet[1 - best].plantedTime > 0.12 && (errs[best] > 0.1 || yawErrs[best] > 0.45) && feet[best].plantedTime > 0.35)
          pick = best;
      }
      if (pick >= 0 && !this.moving && speedN < 0.05) {
        // an idle adjustment must actually move the foot somewhere
        const f = feet[pick];
        const yaw = this.desiredAnchor(pick, 0, stance, _v);
        this.limitStep(pick, _v, yaw);
        if (Math.hypot(_v.x - f.anchor.x, _v.z - f.anchor.z) < 0.04 && Math.abs(wrapAngle(yaw - f.yaw)) < 0.3) pick = -1;
      }
      if (pick >= 0) this.startSwing(pick, t.swing, stance);
    }

    // ---- advance swing
    for (let s = 0; s < 2; s++) {
      const f = feet[s];
      if (f.phase !== 'swing') continue;
      f.s += dt / f.duration;
      // the landing spot keeps adapting early in swing and settles smoothly later
      // (a foothold chosen around an obstacle is committed to at toe-off, as people do:
      // re-planning mid-air would flip between stepping short and stepping long)
      const adapt = f.pace < Infinity ? 0 : 1 - smoothstep(0.45, 0.8, f.s);
      if (adapt > 0) {
        const remaining = (1 - f.s) * f.duration;
        const lead = this.moving ? this.leadTime(t, remaining) : 0;
        const yaw = this.desiredAnchor(s, lead, stance, _c);
        this.limitStep(s, _c, yaw);
        // never slide the landing across an obstacle (the lerp would stop on top of it)
        if (this.heightAlong(f.to, _c) === 0) {
          const k = adapt * Math.min(1, dt * 20);
          f.to.lerp(_c, k);
          f.toYaw += wrapAngle(yaw - f.toYaw) * k;
        }
      }
      if (f.s >= 1) {
        f.phase = 'planted';
        f.anchor.copy(f.to);
        f.yaw = f.toYaw;
        f.landPitch = f.hsPitch;
        f.pitch = f.hsPitch;
        f.plantedTime = 0;
        this.lastStep = s;
        continue;
      }
      // the foot is whipped forward early in swing (the shank trails the thigh, the knee
      // flexes at once) and glides into heel strike
      const e = minimumJerk(Math.pow(f.s, 0.8));
      const land = f.ankleFor(f.to, f.toYaw, f.hsPitch, _a);
      f.ankle.lerpVectors(f.from, land, e);
      // carry the toe-off velocity into the swing, fading out: h(s) = s(1-s)²
      f.ankle.addScaledVector(f.fromVel, f.duration * f.s * (1 - f.s) * (1 - f.s));
      // ankle rises early in swing (knee flexion), clearance peak ≈ 37% of swing;
      // the hump starts and ends with zero velocity (no pop at lift-off / touch-down)
      f.ankle.y += f.lift * swingHump(f.s);
      // stepping over something: same timing and path, just a higher, flat-topped arc
      // (the obstacle sits mid-step, so the plateau covers it); smooth max, no kink
      if (f.clear > 0) {
        // flat top over the obstacle, ramps as long as the step allows: the foot rises
        // all the way up to it and sets down all the way after it (no snapping up)
        const arc = smoothstep(0, f.overOn, f.s) * (1 - smoothstep(f.overOff, 1, f.s));
        f.ankle.y = -softMin(-f.ankle.y, -f.clear * arc, 0.06);
      }
      f.yaw = f.fromYaw + wrapAngle(f.toYaw - f.fromYaw) * e;
      const mid = -0.08;
      f.pitch = f.s < 0.5 ? lerp(f.fromPitch, mid, minimumJerk(f.s / 0.5)) : lerp(mid, f.hsPitch, minimumJerk((f.s - 0.5) / 0.5));
      // toe clearance
      f.updateOrientation();
      const toeY = f.toeLocal(_b).applyQuaternion(f.q).y + f.ankle.y;
      const heelY = f.heelLocal(_b).applyQuaternion(f.q).y + f.ankle.y;
      const minY = Math.min(toeY, heelY);
      // continuous clearance correction (fades in/out with the swing)
      f.ankle.y += Math.max(0, 0.012 - minY) * Math.sin(Math.PI * f.s);
    }
  }

  private startSwing(s: number, swingTime: number, stance: Stance) {
    const f = this.feet[s];
    this.lastLift = s;
    this.lastLiftAt = this.clock;
    const t = this.timing();
    const lead = this.moving ? this.leadTime(t, swingTime) : 0;
    f.toYaw = this.desiredAnchor(s, lead, stance, f.to);
    const planned = this.limitStep(s, f.to, f.toYaw);
    const stepLen = Math.hypot(f.to.x - f.anchor.x, f.to.z - f.anchor.z);
    // nobody lifts a foot to move it a couple of centimetres
    if (stepLen < 0.1 * (this.d.height / 1.75) && Math.abs(wrapAngle(f.toYaw - f.yaw)) < 0.45) return;
    const H = this.d.height / 1.75;
    f.phase = 'swing';
    f.s = 0;
    // short steps are quick; long walking strides follow the cadence
    const H175 = this.d.height / 1.75;
    f.duration = t.run > 0.5 ? swingTime : clamp(0.24 + 0.32 * (stepLen / H175), 0.28, this.moving ? swingTime : 0.45);
    // pivots and tiny adjustments barely clear the floor
    // just enough clearance: the foot skims forward rather than kicking up behind
    f.lift = (stepLen < 0.06 ? 0.015 : lerp(clamp(0.02 + 0.035 * stepLen, 0.03, 0.07), 0.2, t.run)) * H;
    f.hsPitch = this.moving ? lerp(0.28 * this.walk + 0.04, 0.12, t.run) : 0.04;
    f.from.copy(f.ankle);
    f.fromVel.subVectors(f.ankle, f.prevAnkle).divideScalar(this.lastDt);
    // carry the forward push-off, not an upward flick
    f.fromVel.y = Math.min(f.fromVel.y, 0.25);
    if (f.fromVel.length() > 1.5) f.fromVel.setLength(1.5);
    f.fromYaw = f.yaw;
    f.fromPitch = f.pitch;
    // anything to step over on the way? (toe-obstacle clearance ~10 cm, as people do)
    const h = this.heightAlong(f.anchor, f.to);
    f.clear = h > 0 ? h + this.d.ankleHeight + 0.1 * H : 0;
    // a high step is a little slower, and lifts rather than flicks forward
    if (f.clear > 0) {
      this.overSpan(f);
      f.duration *= 1.35;
      f.fromVel.set(0, 0, 0);
    }
    // (a swing covers a stride — two steps — in two step times)
    f.pace = planned || f.clear > 0 ? stepLen / (2 * (f.duration + t.doubleSupport)) : Infinity;
  }

  /** the part of the swing (progress s) where the foot is above an obstacle */
  private overSpan(f: Foot) {
    const yaw = yawOf(f.to.x - f.from.x, f.to.z - f.from.z);
    f.overOn = 1;
    f.overOff = 0;
    for (let s = 0; s <= 1; s += 0.02) {
      const e = minimumJerk(Math.pow(s, 0.8));
      if (this.heightUnderFoot(lerp(f.from.x, f.to.x, e), lerp(f.from.z, f.to.z, e), yaw, this.d.toeFront + 0.03, this.d.heelBack + 0.03) === 0) continue;
      f.overOn = Math.min(f.overOn, s);
      f.overOff = s;
    }
    // the sole only needs to clear the edges by a few cm (the 10 cm margin is for the
    // apex), so the ramps may run on past them: a gentler rise and set-down
    const h = f.clear - this.d.ankleHeight - 0.1 * (this.d.height / 1.75);
    const q = clamp((h + this.d.ankleHeight + 0.03) / f.clear, 0, 1);
    const x = 0.5 - Math.sin(Math.asin(1 - 2 * q) / 3); // smoothstep(x) = q
    // (and never a vertical snap, even with the obstacle right at the start or end)
    f.overOn = clamp(f.overOn / x, 0.2, 0.5);
    f.overOff = clamp(1 - (1 - f.overOff) / x, f.overOn, 0.8);
  }

  /** tallest obstacle under a foot footprint (toe to heel along `yaw`) */
  private heightUnderFoot(x: number, z: number, yaw: number, front: number, back: number, frontPerHeight = 0): number {
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    let h = 0;
    for (const o of this.obstacles) {
      if (!o.height) continue;
      const fr = front + frontPerHeight * o.height;
      // dense along the sole: thin obstacles (a hurdle bar) must not slip between samples
      const n = Math.max(2, Math.ceil((fr + back) / 0.03));
      for (let i = 0; i <= n; i++) {
        const k = -back + ((fr + back) * i) / n;
        const px = x + fx * k,
          pz = z + fz * k;
        if (px > o.minX && px < o.maxX && pz > o.minZ && pz < o.maxZ) h = Math.max(h, o.height);
      }
    }
    return h;
  }

  /** tallest obstacle a footprint sweeps over moving from `a` to `b` */
  private heightAlong(a: Vector3, b: Vector3): number {
    if (!this.obstacles.some((o) => o.height)) return 0;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = len > 1e-3 ? yawOf(b.x - a.x, b.z - a.z) : 0;
    const n = Math.max(1, Math.ceil(len / 0.03));
    let h = 0;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      h = Math.max(h, this.heightUnderFoot(lerp(a.x, b.x, u), lerp(a.z, b.z, u), yaw, this.d.toeFront + 0.03, this.d.heelBack + 0.03));
    }
    return h;
  }

  /**
   * Footstep planning over obstacles: a foot never lands on one, and the choice looks one
   * footfall ahead, so the next step can cross with the obstacle mid-step. The adjustment
   * is spread over both steps (as people do) instead of a stutter step or a lunge.
   */
  /** true when the landing was moved */
  private avoidLandingOn(s: number, to: Vector3): boolean {
    if (!this.obstacles.some((o) => o.height)) return false;
    const f = this.feet[s];
    const other = this.feet[1 - s].anchor;
    const dx = to.x - f.anchor.x,
      dz = to.z - f.anchor.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return false;
    const ux = dx / len,
      uz = dz / len;
    const yaw = yawOf(ux, uz);
    // (heel lands ~10 cm past the edge; stopping short keeps the toe back by about the
    // obstacle's height — room to lift the foot at ~45° before it gets there)
    const blockedAt = (x: number, z: number) => this.heightUnderFoot(x, z, yaw, this.d.toeFront + 0.05, this.d.heelBack + 0.1, 1) > 0;
    // the next footfall lands about one normal step length further on (the gait's own
    // step, not this possibly adjusted one)
    const t = this.timing();
    // (reach is judged from the other foot: a step, not the swing's own travel)
    const maxStep = lerp(0.55, 1.05, this.run) * this.d.height;
    const stepLen = clamp(Math.max(this.speed, Math.hypot(this.targetVel.x, this.targetVel.z)) * t.stepT, 0.2 * (this.d.height / 1.75), maxStep);
    const nextFix = (px: number, pz: number) => {
      for (let k = 0; k <= 0.5; k += 0.02) {
        if (!blockedAt(px + ux * (stepLen + k), pz + uz * (stepLen + k))) return k;
        if (!blockedAt(px + ux * (stepLen - k / 1.5), pz + uz * (stepLen - k / 1.5))) return k;
      }
      return 0.5;
    };
    // keep both steps close to a normal step (people regulate step length, not where
    // the body happens to be). Shortening counts extra: it leaves the obstacle still
    // ahead, needing yet another short step — people prefer lengthening
    const cost = (d: number) => {
      const px = f.anchor.x + ux * d,
        pz = f.anchor.z + uz * d;
      const dev = (px - other.x) * ux + (pz - other.z) * uz - stepLen;
      return (dev < 0 ? 1.5 * dev : dev) ** 2 + nextFix(px, pz) ** 2;
    };
    if (!blockedAt(to.x, to.z) && nextFix(to.x, to.z) === 0) return false;
    let best = -1,
      bestCost = Infinity;
    for (let d = 0.05; d <= 2 * maxStep; d += 0.02) {
      const px = f.anchor.x + ux * d,
        pz = f.anchor.z + uz * d;
      if (blockedAt(px, pz)) continue;
      // (beyond reach only if nothing else is free: a lunge beats landing on it)
      const c = cost(d) + 10 * Math.max(0, Math.hypot(px - other.x, pz - other.z) - maxStep);
      if (c < bestCost) {
        bestCost = c;
        best = d;
      }
    }
    if (best < 0) return false;
    to.set(f.anchor.x + ux * best, to.y, f.anchor.z + uz * best);
    return true;
  }

  /** `landingYaw`: the foot's heading at landing — lateral order is judged in the frame
   * the body will have then (it keeps turning while the foot is in the air) */
  private limitStep(s: number, to: Vector3, landingYaw?: number): boolean {
    // no crossing in the body's heading now, nor in the heading it will have at landing
    if (landingYaw !== undefined) this.limitLateral(s, to, landingYaw - this.stanceRef.turn - this.feet[s].side * this.stanceRef.toeOut);
    this.limitLateral(s, to, this.root.yaw);
    this.limitReach(s, to);
    return this.avoidLandingOn(s, to);
  }

  private limitLateral(s: number, to: Vector3, fy: number) {
    const other = this.feet[1 - s];
    const side = this.feet[s].side;
    const lx = Math.cos(fy),
      lz = -Math.sin(fy);
    const rx = to.x - other.anchor.x;
    const rz = to.z - other.anchor.z;
    const lateral = (rx * lx + rz * lz) * side;
    const minLat = 0.05 * this.d.height;
    // side-steps are short shuffles: the feet never spread much wider than the hips
    const maxLat = Math.max(minLat + 0.3 * this.d.height, 2.3 * this.stanceRef.width);
    const clampLat = clamp(lateral, minLat, maxLat);
    if (clampLat !== lateral) {
      to.x += lx * side * (clampLat - lateral);
      to.z += lz * side * (clampLat - lateral);
    }
  }

  private limitReach(s: number, to: Vector3) {
    const other = this.feet[1 - s];
    // step length grows with speed; the first steps from standing are short
    const H = this.d.height / 1.75;
    const span = Math.hypot(2 * this.stanceRef.width, this.stanceRef.stagger);
    const maxStep = Math.max(
      1.15 * span,
      Math.min(lerp(0.55, 1.05, this.run) * this.d.height, (0.32 + 0.55 * Math.max(this.speed, Math.hypot(this.targetVel.x, this.targetVel.z) * 0.5)) * H),
    );
    const dx = to.x - other.anchor.x;
    const dz = to.z - other.anchor.z;
    const dl = Math.hypot(dx, dz);
    if (dl > maxStep) {
      to.x = other.anchor.x + (dx * maxStep) / dl;
      to.z = other.anchor.z + (dz * maxStep) / dl;
    }
  }

  /** forward vector of the body */
  forward(out = new Vector3()) {
    return forwardOf(this.root.yaw, out);
  }
}
