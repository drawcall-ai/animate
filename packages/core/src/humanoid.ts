import { Matrix4, Quaternion, Vector3 } from 'three';
import { createBodyDimensions, type BodyDimensions } from './body';
import { Gait, type Foot } from './gait';
import { solveTwoBone } from './ik';
import {
  clamp,
  forwardOf,
  leftOf,
  lerp,
  minimumJerk,
  quatYXZ,
  smoothstep,
  softMin,
  DampedSpring,
  Spring,
  toVector3,
  wrapAngle,
  yawOf,
  type QuatLike,
  type Vec3Like,
} from './math';
import { createPose, type Pose } from './pose';
import {
  createTorsoFrame,
  defaultStance,
  headFrom,
  NP,
  P,
  PostureSolver,
  torsoFK,
  zeroOverlay,
  type Obstacle,
  type OrientedTask,
  type PostureTasks,
  type Stance,
  type Task,
} from './posture';

export interface Effector {
  position?: Vec3Like;
  rotation?: QuatLike;
  /** 0..1 blend between the inferred pose and this target (default 1) */
  weight?: number;
}

/** Every field is optional — whatever is missing is inferred. */
export interface HumanoidInput {
  head?: Effector;
  torso?: Effector;
  pelvis?: Effector;
  /** wrist targets */
  leftHand?: Effector;
  rightHand?: Effector;
  /** ankle targets (kicks, stepping on things); the other foot becomes the support */
  leftFoot?: Effector;
  rightFoot?: Effector;
  /** explicit gaze target */
  lookAt?: Vec3Like;
  /** floor areas to keep the feet out of (furniture, walls); low ones (`height`) are stepped over */
  obstacles?: Obstacle[];
  /** volumes the trunk and head must stay clear of (a held box, a table edge) */
  avoid?: { center: Vec3Like; radius: number }[];
  /** preferred standing spot on the floor (x, z; y is ignored), optionally with a facing rotation */
  root?: Effector;
  /**
   * Sit here: `position` is the seat surface under the pelvis, `rotation` the seated facing
   * (default: facing away from where the body comes from). The body walks up, turns its
   * back to the seat and sits down; remove the seat and it stands up again. `weight` < 1
   * only perches.
   */
  seat?: Effector;
}

export interface HumanoidOptions {
  height?: number;
  position?: Vec3Like;
  yaw?: number;
  stance?: Partial<Stance>;
  maxSpeed?: number;
  /** how quickly the body speeds up (m/s², default 1.2; ~2.5 for a runner) */
  accel?: number;
  /** turn to face the walking direction on longer walks (default true) */
  faceTravel?: boolean;
  /** movement style multipliers (1 = natural): `hips` pelvic rotation/list/sway, `armSwing` */
  style?: Partial<MoveStyle>;
}

export interface MoveStyle {
  hips: number;
  armSwing: number;
}

const SMOOTHED = [P.YAW, P.DROP, P.SHIFT, P.HIP, P.SPINE, P.ROLL, P.TWIST, P.SIDE];
/** max speed per smoothed parameter (rad/s or m/s) — how fast a person moves each */
const MAX_RATE = [2.5, 1.1, 0.6, 2.5, 2.5, 2.0, 4.0, 0.5];
const SIDES = ['left', 'right'] as const;

const _v = new Vector3();
const _w = new Vector3();
const _f = new Vector3();
const _l = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _pole = new Vector3();
const _up = new Vector3();
const _m4 = new Matrix4();
const _q2b = new Quaternion();
const _kneeTmp = new Vector3();
const _ankleTmp = new Vector3();
const _target = new Vector3();
const _gz = new Vector3();

export class Humanoid {
  readonly dims: BodyDimensions;
  readonly stance: Stance;
  readonly style: MoveStyle;
  readonly pose: Pose = createPose();
  readonly gait: Gait;
  time = 0;

  private solver: PostureSolver;
  private plan = new Float64Array(NP);
  private raw = new Float64Array(NP);
  private stay = new Float64Array(NP);
  private goal = { x: 0, z: 0, yaw: 0 };
  private cur = new Float64Array(NP);
  private springs = SMOOTHED.map(() => new Spring());
  private reach = [new Spring(), new Spring()];
  private lastHand = [new Vector3(), new Vector3()];
  private lastW = [0, 0];
  private prevHead = new Vector3();
  private headSpeed = new Spring();
  private trackMoving = false;
  /** vertical oscillation already present in a tracked input (real trackers bob, scripted paths don't) */
  private trackerY = new Spring();
  private trackerBob = 0;
  private trackerInit = false;
  /** sitting: progress 0 (standing) → 1 (seated), the seat and the spot in front of it */
  private seatU = 0;
  private sit = 0;
  private seatWeight = 1;
  private seatOn = false;
  private seatHold = false;
  private seatPos = new Vector3();
  private seatYaw = 0;
  private seatStand = new Vector3();
  private bobPhase = 0;
  private prevHand = [new Vector3(), new Vector3()];
  private handSpeed = new Spring();
  private swing = [new Spring(), new Spring()];
  private sway = new Spring();
  private lagPitch = new DampedSpring(7, 0.55);
  private lagRoll = new DampedSpring(7, 0.55);
  private headPitch = new DampedSpring(11, 0.45);
  private headYaw = new DampedSpring(11, 0.45);
  private lastVel = new Vector3();
  private pitchSprings = [new Spring(), new Spring()];
  private gazeYaw = new Spring();
  private gazePitch = new Spring();
  private torso = createTorsoFrame();
  private overlay = zeroOverlay();
  private tasks: PostureTasks = emptyTasks();
  private intent: PostureTasks = emptyTasks();
  private headRot: Quaternion | null = null;
  private lookAt: Vector3 | null = null;
  private hasTask = false;

  constructor(opts: HumanoidOptions = {}) {
    this.dims = createBodyDimensions(opts.height ?? 1.75);
    this.stance = { ...defaultStance(this.dims), ...opts.stance };
    this.style = { hips: 1, armSwing: 1, ...opts.style };
    this.solver = new PostureSolver(this.dims);
    this.baseMaxSpeed = opts.maxSpeed ?? 1.3;
    this.gait = new Gait(this.dims, { maxSpeed: this.baseMaxSpeed, accel: opts.accel ?? 1.2, turnRate: 1.5 });
    this.gait.faceTravel = opts.faceTravel === false ? 0 : 1;
    const p = opts.position ?? { x: 0, y: 0, z: 0 };
    this.goal = { x: p.x, z: p.z, yaw: opts.yaw ?? 0 };
    this.reset(p.x, p.z, opts.yaw ?? 0);
  }

  reset(x: number, z: number, yaw: number) {
    this.gait.reset(x, z, yaw, this.stance);
    this.goal = { x, z, yaw };
    this.staying = true;
    for (const a of [this.plan, this.raw, this.cur]) {
      a.fill(0);
      a[P.X] = x;
      a[P.Z] = z;
      a[P.YAW] = yaw;
      a[P.DROP] = this.stance.crouch;
    }
    SMOOTHED.forEach((k, i) => this.springs[i].reset(this.cur[k]));
    this.gazeYaw.reset(yaw);
    this.gazePitch.reset(0.1);
    this.solvePose(0);
  }

  /**
   * A hit or shove: `direction` is where the force pushes (world), `strength` ~0.3 for
   * a light tap, 1 for a solid punch. `where` picks the body region. The trunk/head
   * recoil and settle, and a strong push makes the body stagger (the gait catches it).
   */
  impulse(direction: Vec3Like, strength = 1, where: 'head' | 'body' = 'body') {
    const g = this.gait;
    const fwd = forwardOf(g.root.yaw, _f);
    const left = leftOf(g.root.yaw, _l);
    const f = direction.x * fwd.x + direction.z * fwd.z;
    const l = direction.x * left.x + direction.z * left.z;
    const s = clamp(strength, 0, 2);
    if (where === 'head') {
      // head snaps back / aside, trunk follows a little
      this.headPitch.velocity += -f * 7 * s;
      this.headYaw.velocity += l * 7 * s;
      this.lagPitch.velocity += f * 1.5 * s;
      this.lagRoll.velocity += -l * 1.5 * s;
    } else {
      // body shot: fold around it
      this.lagPitch.velocity += -f * 3 * s;
      this.lagRoll.velocity += -l * 3 * s;
      this.headPitch.velocity += f * 2 * s;
    }
    // push the body: a strong hit costs a stagger step
    g.velocity.x += direction.x * 0.45 * s;
    g.velocity.z += direction.z * 0.45 * s;
  }

  /** Advance the simulation. Large steps are sub-stepped for stability. */
  update(input: HumanoidInput, dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    for (let i = 0; i < steps; i++) this.step(input, dt / steps);
  }

  private step(input: HumanoidInput, dt: number) {
    this.time += dt;
    this.readInput(input, dt);
    const g = this.gait;

    // 1. where should I stand? (planner, root free) — and is moving worth it?
    const goal = this.goal;
    if (this.hasTask) {
      const env = {
        mode: 'planner' as const,
        root: g.root,
        support: [null, null] as [null, null],
        moving: g.walk,
        tasks: this.intent,
        stance: this.stance,
      };
      const moveCost = this.solver.solve(this.plan, env, 10);
      this.stay.set(this.plan);
      const stayCost = this.solver.solve(this.stay, { ...env, fixRoot: true }, 6);
      // people don't shuffle for marginal gains: step only when it clearly pays off
      // …and nobody shuffles around in a deep crouch
      // (judged by the planned squat too: don't start shuffling as you go down)
      const crouch = Math.max(0, Math.max(this.cur[P.DROP], this.stay[P.DROP]) - 0.03 * this.dims.height);
      // (a tracked head is followed continuously: no stop-start)
      const eager = this.trackMoving ? 0.2 : 1;
      const worth = stayCost - moveCost > (g.moving ? 0.035 : 0.06) * eager + 1.2 * crouch;
      if (worth && this.seatU === 0 && !(this.seatHold && !this.seatOn)) {
        goal.x = this.plan[P.X];
        goal.z = this.plan[P.Z];
        goal.yaw = this.plan[P.YAW];
        this.staying = false;
      } else this.stayHere();
    } else {
      this.stayHere();
      this.plan[P.X] = goal.x;
      this.plan[P.Z] = goal.z;
      this.plan[P.YAW] = goal.yaw;
    }

    // 2. walk there (facing the path only when nothing else dictates where we look)
    // (a gaze target only holds the body's facing when it's well off the travel direction —
    // circling or backing away from something; otherwise people walk facing where they go
    // and turn their head)
    let faceTravel = this.headRot ? 0 : 1;
    if (!this.headRot && this.lookAt) {
      const v = g.velocity;
      const off = Math.abs(wrapAngle(yawOf(v.x, v.z) - yawOf(this.lookAt.x - g.root.x, this.lookAt.z - g.root.z)));
      faceTravel = Math.hypot(v.x, v.z) > 0.05 ? 1 - smoothstep(1.0, 1.4, off) : 0;
    }
    g.faceTravelNow = faceTravel;
    g.crouched = this.cur[P.DROP] > 0.09 * this.dims.height;
    g.eager = this.trackMoving;
    const trackedBody = !!(this.tasks.head || this.tasks.pelvis || this.tasks.torso);
    g.speedCap = trackedBody ? 2.2 : Infinity;
    g.opts.maxSpeed = trackedBody ? Math.max(this.baseMaxSpeed, 2.2) : this.baseMaxSpeed;
    g.obstacles = this.tasks.obstacles;
    g.update(dt, goal, this.stance, this.tasks.feet);
    this.updateSit(dt);

    // 3. how do I hold myself where I am? (living with the gait's oscillations)
    this.updateOverlay(dt);
    this.rideGaitOnTrackers();
    this.raw[P.X] = g.root.x;
    this.raw[P.Z] = g.root.z;
    this.solver.solve(this.raw, {
      mode: 'posture',
      root: g.root,
      // standing/shuffling: real feet; walking: the gait owns leg reach (virtual stance)
      support: g.walk < 0.5 ? [supportOf(g.feet[0]), supportOf(g.feet[1])] : [null, null],
      footholds: [footholdOf(g.feet[0]), footholdOf(g.feet[1])],
      moving: g.walk,
      stepping: g.moving || g.feet.some((f) => f.phase === 'swing'),
      tasks: this.tasks,
      stance: this.stance,
      overlay: this.overlay,
    }, 6);

    // 4. smooth (bodies have inertia; hands lead, trunk follows; tracked bodies follow tightly)
    // fast hand motions (strikes, throws) drive the trunk quickly too
    let handSpeed = 0;
    for (let s = 0; s < 2; s++) {
      const h = this.tasks.hands[s];
      if (h && dt > 0) handSpeed = Math.max(handSpeed, (h.pos.distanceTo(this.prevHand[s]) / dt) * h.weight);
      if (h) this.prevHand[s].copy(h.pos);
    }
    this.handSpeed.step(handSpeed, 20, dt);
    const tracked = this.tasks.head || this.tasks.torso || this.tasks.pelvis;
    const kicking = Math.max(this.tasks.feet[0]?.weight ?? 0, this.tasks.feet[1]?.weight ?? 0);
    // (untracked bodies follow unhurriedly: ~0.3 s; strikes and kicks are the exception)
    const omega = tracked ? 30 : 4.5 + clamp(this.handSpeed.value * 5, 0, 14) + 12 * kicking;
    SMOOTHED.forEach((k, i) => {
      const sp = this.springs[i];
      let target = k === P.YAW ? sp.value + wrapAngle(this.raw[k] - sp.value) : this.raw[k];
      // human speed limits per degree of freedom: cap the spring's pull (its speed is
      // about ω·offset) rather than clamping its output, so there's no velocity kink —
      // this also rides out the optimiser switching strategy (e.g. squat ↔ hinge)
      const maxRate = MAX_RATE[i] * (tracked ? (k === P.DROP ? 4 : 2.5) : 1) * (k === P.DROP || k === P.SHIFT || k === P.SIDE ? this.dims.height / 1.75 : 1);
      const reach = maxRate / omega;
      target = sp.value + clamp(target - sp.value, -reach, reach);
      this.cur[k] = sp.step(target, omega, dt);
    });
    this.cur[P.X] = g.root.x;
    this.cur[P.Z] = g.root.z;
    // the smoothed (human-paced) posture may lag into an avoid volume: project it out
    if (this.tasks.avoid.length) this.projectOutOfAvoid();

    this.solvePose(dt);
  }

  private readInput(input: HumanoidInput, dt: number) {
    const t = this.tasks;
    const it = this.intent;
    this.hasTask = false;
    for (let s = 0; s < 2; s++) {
      const e = s === 0 ? input.leftHand : input.rightHand;
      const w = e?.position ? clamp(e.weight ?? 1, 0, 1) : 0;
      const pos = e?.position ? toVector3(e.position, it.hands[s]?.pos ?? new Vector3()) : null;
      it.hands[s] = pos && w > 0 ? { pos, weight: w } : null;
      if (it.hands[s]) this.hasTask = true;
      // far targets are walked to first; the arm only reaches once in range.
      // Only this automatic readiness is smoothed — explicit weights pass straight through.
      let ready = 0;
      if (pos && w > 0) {
        // horizontal distance: anything below can be reached by bending/squatting
        const shoulder = this.pose[`${SIDES[s]}Shoulder`];
        const dh = Math.hypot(pos.x - shoulder.x, pos.z - shoulder.z);
        const above = Math.max(0, pos.y - shoulder.y);
        const L = this.dims.armLength;
        const dist = Math.hypot(dh, above);
        ready = 1 - smoothstep(1.4 * L, 2.0 * L, dist);
        // don't reach out while still walking there: arrive, then reach
        const toGoal = Math.hypot(this.goal.x - this.gait.root.x, this.goal.z - this.gait.root.z);
        const low = 1 - smoothstep(0.25 * this.dims.height, 0.45 * this.dims.height, pos.y);
        // floor-level things: arrive and plant first, then go down once
        if (!input.head?.position) ready *= 1 - low * Math.max(smoothstep(0.05, 0.3, this.gait.walk), smoothstep(0.08, 0.2, toGoal));
        ready *= 1 - smoothstep(0.8, 1.4, toGoal) * smoothstep(0.2, 0.5, this.gait.speed) * smoothstep(0.9 * L, 1.3 * L, dist);
        this.lastW[s] = w;
      } else {
        this.lastW[s] = Math.max(0, this.lastW[s] - dt * 0.9);
      }
      // readiness rises at once (a strike is a strike) but relaxes gently
      const sp = this.reach[s];
      const inStrikeRange = pos ? pos.distanceTo(this.pose[`${SIDES[s]}Shoulder`]) < 1.45 * this.dims.armLength : false;
      let r: number;
      // a target that appears already within striking range is struck at once (punches);
      // anything already easing in keeps easing in
      if (ready >= sp.value && inStrikeRange && sp.value < 0.02) r = (sp.reset(ready), ready);
      else if (ready >= sp.value) r = (sp.reset(Math.min(ready, sp.value + 2.2 * dt)), sp.value);
      else r = sp.step(ready, 4, dt);
      // when a target disappears, the hand eases back from where it was
      if (pos) this.lastHand[s].copy(pos);
      const rw = clamp(r, 0, 1) * (pos ? w : this.lastW[s]);
      t.hands[s] = rw > 0.002 ? { pos: this.lastHand[s], weight: rw } : null;

      const fe = s === 0 ? input.leftFoot : input.rightFoot;
      const fw = fe?.position ? clamp(fe.weight ?? 1, 0, 1) : 0;
      t.feet[s] = fe?.position && fw > 0 ? { pos: toVector3(fe.position, t.feet[s]?.pos ?? new Vector3()), weight: fw } : null;
      it.feet[s] = t.feet[s];
    }
    // is a tracked body part (head, pelvis, torso) translating — i.e. walking — rather
    // than just turning or bending? Then the feet follow it eagerly.
    const tracker = input.head?.position ?? input.pelvis?.position ?? input.torso?.position;
    if (tracker && dt > 0) {
      const hp = tracker;
      const v = this.prevHead.distanceTo(_v.set(hp.x, this.prevHead.y, hp.z)) / dt;
      this.prevHead.set(hp.x, this.prevHead.y, hp.z);
      this.headSpeed.step(Math.min(v, 3), 6, dt);
    } else this.headSpeed.step(0, 6, dt);
    this.trackMoving = this.headSpeed.value > 0.12;
    if (tracker && dt > 0) {
      if (!this.trackerInit) this.trackerY.reset(tracker.y);
      this.trackerInit = true;
      const dev = Math.abs(tracker.y - this.trackerY.step(tracker.y, 3, dt));
      this.trackerBob = Math.max(dev, this.trackerBob * Math.exp(-dt / 0.8));
    } else this.trackerInit = false;
    t.head = input.head?.position
      ? { pos: toVector3(input.head.position, t.head?.pos ?? new Vector3()), weight: input.head.weight ?? 1 }
      : null;
    t.torso = oriented(input.torso, t.torso);
    t.pelvis = oriented(input.pelvis, t.pelvis);
    it.head = t.head;
    it.torso = t.torso;
    it.pelvis = t.pelvis;
    if (t.head || t.torso || t.pelvis) this.hasTask = true;
    this.headRot = input.head?.rotation
      ? (this.headRot ?? new Quaternion()).set(input.head.rotation.x, input.head.rotation.y, input.head.rotation.z, input.head.rotation.w)
      : null;
    this.lookAt = input.lookAt ? toVector3(input.lookAt, this.lookAt ?? new Vector3()) : null;
    it.look = this.lookAt;
    it.obstacles = t.obstacles = input.obstacles ?? [];
    it.avoid = t.avoid = (input.avoid ?? []).map((a) => ({ center: toVector3(a.center), radius: a.radius }));
    const re = input.root;
    it.stand =
      re?.position && (re.weight ?? 1) > 0
        ? {
            pos: toVector3(re.position, it.stand?.pos ?? new Vector3()),
            weight: clamp(re.weight ?? 1, 0, 1),
            yaw: re.rotation ? yawOf(...headForward(_q.set(re.rotation.x, re.rotation.y, re.rotation.z, re.rotation.w))) : null,
          }
        : null;
    t.stand = null;
    // seat: stand in front of it with the back to it (held until back up on the feet)
    const se = input.seat;
    const wasOn = this.seatOn;
    this.seatOn = !!se?.position && (se.weight ?? 1) > 0;
    if (this.seatOn) {
      toVector3(se!.position!, this.seatPos);
      this.seatWeight = clamp(se!.weight ?? 1, 0, 1);
      if (se!.rotation) this.seatYaw = yawOf(...headForward(_q.set(se!.rotation.x, se!.rotation.y, se!.rotation.z, se!.rotation.w)));
      else if (!wasOn && this.seatU === 0) this.seatYaw = yawOf(this.gait.root.x - this.seatPos.x, this.gait.root.z - this.seatPos.z);
      // feet a little behind the knees, ready to take the weight again
      forwardOf(this.seatYaw, this.seatStand).multiplyScalar(0.33 * (this.dims.height / 1.75)).add(this.seatPos);
    }
    // (held until the body is back up on its feet)
    this.seatHold = this.seatOn || this.seatU > 0 || (this.seatHold && this.cur[P.DROP] > 0.04 * this.dims.height);
    if (this.seatHold) {
      // (the gait walks up facing the way it goes and turns its back to the seat on arrival)
      it.stand = { pos: (it.stand?.pos ?? new Vector3()).copy(this.seatStand), weight: 1, yaw: this.seatYaw };
    }
    t.seat =
      this.sit > 0
        ? { pos: (t.seat?.pos ?? new Vector3()).copy(this.seatPos).setY(this.seatPos.y + 0.085 * (this.dims.height / 1.75)), weight: this.sit }
        : null;
    if (it.stand) this.hasTask = true;
    t.headYaw = it.headYaw = this.headRot ? yawOf(...headForward(this.headRot)) : null;
    t.headRot = it.headRot = this.headRot;
    if (this.lookAt) this.hasTask = true;
  }

  // ------------------------------------------------------------------ pose

  /**
   * Push the trunk/head out of avoid volumes by nudging lean, pelvis shift, side bend and
   * squat depth (a few Gauss–Newton steps on the penetration depth). Springs continue
   * from the corrected values, so the body visibly gives way instead of passing through.
   */
  private projectOutOfAvoid() {
    const d = this.dims;
    const p = this.cur;
    const trunkR = 0.065 * d.height;
    const headR = 0.06 * d.height;
    const tf = this.torso;
    const pen = () => {
      torsoFK(p, d, this.stance, tf, this.overlay, this.headRot);
      let worst = 0;
      for (const a of this.tasks.avoid) {
        worst = Math.max(
          worst,
          a.radius + trunkR - segDist(a.center, tf.pelvis, tf.spine),
          a.radius + trunkR - segDist(a.center, tf.spine, tf.chest),
          a.radius + trunkR - segDist(a.center, tf.chest, tf.neck),
          a.radius + headR - a.center.distanceTo(tf.headCenter),
        );
      }
      return worst;
    };
    const dofs = [P.HIP, P.SPINE, P.SHIFT, P.SIDE, P.ROLL, P.DROP];
    for (let it = 0; it < 4; it++) {
      const e = pen();
      if (e <= 0.002) break;
      const grad = dofs.map((k) => {
        const saved = p[k];
        p[k] = saved + 1e-3;
        const g1 = pen();
        p[k] = saved;
        return (g1 - e) / 1e-3;
      });
      const g2 = grad.reduce((acc, v) => acc + v * v, 0);
      if (g2 < 1e-9) break;
      dofs.forEach((k, i) => (p[k] -= (e * grad[i]) / g2));
    }
    SMOOTHED.forEach((k, i) => {
      if (dofs.includes(k as never)) this.springs[i].value = p[k];
    });
  }

  private gaitLift = 0;
  private baseMaxSpeed = 1.3;
  private reachLift = 0;
  private reachSpring = new Spring();
  private staying = false;

  /** freeze the goal where we are (a goal that follows the root would feed its own velocity back) */
  private stayHere() {
    if (this.staying) return;
    this.staying = true;
    const r = this.gait.root;
    this.goal.x = r.x;
    this.goal.z = r.z;
    this.goal.yaw = r.yaw;
  }

  /** sit down once standing in front of the seat, facing away; stand up when it's gone */
  private updateSit(dt: number) {
    const g = this.gait;
    const arrived =
      Math.hypot(g.root.x - this.seatStand.x, g.root.z - this.seatStand.z) < 0.08 &&
      Math.abs(wrapAngle(g.root.yaw - this.seatYaw)) < 0.25 &&
      g.speed < 0.15 &&
      g.feet.every((f) => f.phase === 'planted');
    const down = this.seatOn && (this.seatU > 0 || arrived);
    // ~1.4 s to sit, ~1.2 s to stand (minimum-jerk profile)
    this.seatU = clamp(this.seatU + (down ? dt / 1.4 : -dt / 1.2), 0, 1);
    this.sit = minimumJerk(this.seatU) * this.seatWeight;
  }

  /**
   * A tracked head/torso/pelvis path without its own gait oscillation (a scripted path,
   * a joystick) would pin the body on rails: let the gait's bob and sway ride on top of
   * it. Real trackers already bob, and are left exactly where they are.
   */
  private rideGaitOnTrackers() {
    const t = this.tasks;
    const k = 1 - smoothstep(0.004, 0.012, this.trackerBob);
    if (k <= 0) return;
    const left = leftOf(this.gait.root.yaw, _l);
    // (the untracked body gets its bob from the legs' geometry; a pinned height has none,
    // so add the inverted-pendulum rise over the stance leg: ~3 cm peak to peak)
    const g = this.gait;
    const bob = (0.017 * this.bobPhase - 0.012) * this.dims.height * g.walk * (1 - g.run) * smoothstep(0.3, 1.2, g.speed);
    for (const task of [t.head, t.torso, t.pelvis]) {
      if (!task?.pos) continue;
      task.pos.y += (this.gaitLift + bob) * k;
      task.pos.addScaledVector(left, this.overlay.side * k);
    }
  }

  /** gait oscillations: pelvic rotation/obliquity/sway/bob, thorax counter-rotation, leans */
  private updateOverlay(dt: number) {
    const { dims: d, gait: g, overlay: ov } = this;
    const [lf, rf] = g.feet;
    const walk = g.walk;
    const fwd = forwardOf(g.root.yaw, _f);
    const hips = this.style.hips;
    // pelvic rotation: the swinging leg's hip travels forward with it (~±7°), the
    // thorax counter-rotates
    const ahead = (lf.ankle.x - rf.ankle.x) * fwd.x + (lf.ankle.z - rf.ankle.z) * fwd.z;
    ov.pelvisYaw = clamp(-0.2 * ahead, -0.13, 0.13) * walk * hips;
    ov.chestYaw = 1.6 * ov.pelvisYaw;
    let roll = 0;
    let swayTarget = 0;
    let bob = 0;
    for (const f of g.feet) {
      if (f.phase === 'swing') {
        // pelvic list: the swing side drops (~5°) while the weight is on the other leg,
        // and the pelvis shifts over that stance foot (~2 cm each way)
        roll += -f.side * 0.09 * Math.sin(Math.PI * Math.min(1, f.s * 1.3)) * walk * hips;
        swayTarget = -f.side * 0.013 * d.height * walk * hips;
        bob = Math.sin(Math.PI * f.s);
      }
      if (f.phase === 'lifted') {
        swayTarget = -f.side * 0.03 * d.height * f.liftWeight;
      }
    }
    ov.pelvisRoll = roll;
    this.bobPhase = bob;
    ov.side = dt > 0 ? this.sway.step(swayTarget, 13, dt) : 0;
    // inverted-pendulum bob: lowest in double support, highest at mid-stance (~3–4 cm p-p)
    // (the legs' geometry already dips the pelvis in double support; add only a hint)
    const walkLift = -(0.001 + 0.003 * (1 - bob)) * d.height * walk;
    // running: the leg compresses through stance (lowest mid-stance), the body flies
    const run = g.run;
    let runLift = 0;
    if (run > 0) {
      const t = g.timing();
      let comp = 0;
      for (const f of g.feet) if (f.phase === 'planted') comp = Math.max(comp, Math.sin(Math.PI * clamp(f.plantedTime / t.stance, 0, 1)));
      runLift = -(0.025 + 0.03 * comp) * d.height;
    }
    this.gaitLift = lerp(walkLift, runLift, run);
    // last frame's leg-reach lowering too, so tracked targets can compensate for it
    ov.lift = this.gaitLift + (this.tasks.head ? this.reachLift : 0);
    // weight: the upper body is a damped pendulum on the pelvis — it lags when the
    // body accelerates (a little lurch back when setting off, forward when stopping)
    // and absorbs impacts, then settles with a slight overshoot
    if (dt > 0) {
      const acc = _v.subVectors(g.velocity, this.lastVel).divideScalar(dt);
      this.lastVel.copy(g.velocity);
      const left = leftOf(g.root.yaw, _l);
      const k = 2.2;
      this.lagPitch.step(-k * clamp(acc.dot(fwd), -4, 4), dt);
      this.lagRoll.step(k * clamp(acc.dot(left), -4, 4), dt);
      this.headPitch.step(0, dt);
      this.headYaw.step(0, dt);
      this.lagPitch.value = clamp(this.lagPitch.value, -0.25, 0.25);
      this.lagRoll.value = clamp(this.lagRoll.value, -0.2, 0.2);
    }
    // a light, brisk walk carries the trunk slightly forward (~3°)
    ov.lean = 0.05 * walk + 0.1 * g.run + this.lagPitch.value;
    ov.chestRoll = this.lagRoll.value;
  }

  private solvePose(dt: number) {
    const { dims: d, gait: g, torso: tf, overlay: ov, pose } = this;
    const fwd = forwardOf(g.root.yaw, _f);
    const p = this.cur;
    ov.lift = this.gaitLift;
    torsoFK(p, d, this.stance, tf, ov, this.headRot);

    // pelvis height: legs must reach their feet (heel-off allowed for trailing feet).
    // Each foot's constraint fades in and out continuously — the landing foot during
    // late swing, the lifting foot during early swing — so contacts don't pop the pelvis.
    const reach = 0.9998 * d.legLength;
    const hMaxAt = (hip: Vector3, ankle: Vector3) => {
      const h2 = reach * reach - ((hip.x - ankle.x) ** 2 + (hip.z - ankle.z) ** 2);
      return ankle.y + Math.sqrt(Math.max(1e-4, h2));
    };
    const tiptoe = this.cur[P.DROP] < -0.005 && g.walk < 0.2;
    let limit = Infinity;
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const hip = tf.hips[s];
      if (f.phase === 'planted') {
        const behind = -((f.anchor.x - hip.x) * fwd.x + (f.anchor.z - hip.z) * fwd.z);
        const maxHeelOff = behind > 0.05 || tiptoe ? -0.75 : f.landPitch * (1 - smoothstep(0, 0.15, f.plantedTime));
        limit = Math.min(limit, hMaxAt(hip, f.ankleFor(f.anchor, f.yaw, maxHeelOff, _v)));
      } else if (f.phase === 'swing') {
        const relax = 0.4 * d.height;
        // a lifted foot no longer holds the pelvis down (the body vaults up over the
        // stance leg; the pelvis-height spring smooths the release); the landing foot's
        // constraint fades in during late swing
        if (f.s > 0.5) {
          const land = hMaxAt(hip, f.ankleFor(f.to, f.toYaw, f.hsPitch, _v)) + relax * (1 - smoothstep(0.5, 1, f.s));
          limit = Math.min(limit, land);
        }
      }
    }
    let reachLift = 0;
    if (limit < Infinity) {
      const hipY = tf.hips[0].y * 0.5 + tf.hips[1].y * 0.5;
      const allowed = softMin(hipY, limit, 0.01);
      // never collapse: a leg that still cannot reach is resolved by the step logic
      reachLift = clamp(allowed - hipY, -0.03 * d.height, 0);
    }
    this.reachLift = dt > 0 ? this.reachSpring.step(reachLift, 25, dt) : reachLift;
    if (this.reachLift < 0) {
      ov.lift = this.gaitLift + this.reachLift;
      torsoFK(p, d, this.stance, tf, ov, this.headRot);
    }

    pose.pelvis.copy(tf.pelvis);
    pose.spine.copy(tf.spine);
    pose.chest.copy(tf.chest);
    pose.neck.copy(tf.neck);

    this.solveLegs(dt);
    this.solveArms(dt);
    this.solveHead(dt);
  }

  private solveLegs(dt: number) {
    const { dims: d, gait: g, torso: tf, pose } = this;
    const fwd = forwardOf(g.root.yaw, _f);
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const side = SIDES[s];
      const hip = tf.hips[s];
      if (f.phase === 'planted') {
        let pitch = 0;
        const rockerT = 0.12;
        if (f.plantedTime < rockerT && f.landPitch > 0) {
          // heel rocker: foot rolls flat about the heel after heel strike
          pitch = f.landPitch * (1 - smoothstep(0, rockerT, f.plantedTime));
        } else {
          // terminal stance: heel rises as the body passes over the foot
          const behind = -((f.anchor.x - hip.x) * fwd.x + (f.anchor.z - hip.z) * fwd.z);
          const other = g.feet[1 - s];
          const trailing = other.phase !== 'planted' ? 1 : 1 - 0.6 * smoothstep(0.1, 0.35, other.plantedTime);
          pitch = -clamp((behind - 0.07 * d.height) * 2.2, 0, 0.7) * g.walk * trailing;
          // and whenever the leg could not otherwise reach
          const reach = 0.9995 * d.legLength;
          if (hip.distanceTo(f.ankleFor(f.anchor, f.yaw, pitch, _v)) > reach) {
            let lo = -0.9,
              hi = pitch;
            for (let i = 0; i < 14; i++) {
              const mid = (lo + hi) / 2;
              if (hip.distanceTo(f.ankleFor(f.anchor, f.yaw, mid, _v)) > reach) hi = mid;
              else lo = mid;
            }
            pitch = lo;
          }
        }
        // ankle dorsiflexion tops out ~35°: in a deep squat the heels come up
        if (pitch <= 0) {
          f.ankleFor(f.anchor, f.yaw, pitch, _v);
          forwardOf(f.yaw, _pole);
          _pole.add(forwardOf(g.root.yaw + this.stance.turn, _w)).normalize();
          _pole.y = 0.15;
          solveTwoBone(hip, _v, d.thigh, d.shin, _pole, _kneeTmp, _ankleTmp, 0.9995);
          const shin = _kneeTmp.sub(_ankleTmp);
          const fx = Math.sin(f.yaw),
            fz = Math.cos(f.yaw);
          const tilt = Math.atan2(shin.x * fx + shin.z * fz, shin.y);
          if (tilt > 0.62) pitch = Math.min(pitch, -Math.min(0.7, (tilt - 0.62) * 1.2));
        }
        // (continuous through 0: the pivot switches heel↔ball exactly where both agree)
        f.pitch = dt > 0 ? this.pitchSprings[s].step(pitch, 30, dt) : pitch;
        f.ankleFor(f.anchor, f.yaw, f.pitch, f.ankle);
      } else {
        this.pitchSprings[s].reset(f.pitch);
      }
      f.updateOrientation();

      // knees track over the toes (blended with the body heading for robustness);
      // a leg raised forward (kick, high step) bends with the knee up, never flipping
      forwardOf(f.yaw, _pole);
      _pole.add(forwardOf(g.root.yaw + this.stance.turn, _w)).normalize();
      const legDir = _w.subVectors(f.ankle, hip).normalize();
      _pole.y = 0.15 + 2.5 * Math.max(0, legDir.dot(_pole) + 0.2);
      pose[`${side}Hip`].copy(hip);
      f.prevAnkle.copy(f.ankle);
      solveTwoBone(hip, f.ankle, d.thigh, d.shin, _pole, pose[`${side}Knee`], pose[`${side}Ankle`], 0.9995, 0.012);
      // a knee inside an avoid volume swings sideways around it (knees splay around a box)
      for (const a of this.tasks.avoid) {
        const knee = pose[`${side}Knee`];
        const kneeR = 0.035 * d.height;
        if (knee.distanceTo(a.center) >= a.radius + kneeR) continue;
        const out = leftOf(g.root.yaw, _w).multiplyScalar(f.side);
        for (let k = 1; k <= 6 && knee.distanceTo(a.center) < a.radius + kneeR; k++) {
          _pole.addScaledVector(out, 0.35).normalize();
          solveTwoBone(hip, f.ankle, d.thigh, d.shin, _pole, knee, pose[`${side}Ankle`], 0.9995, 0.012);
        }
      }
      this.footPoints(f, s);
    }
  }

  private footPoints(f: Foot, s: number) {
    const { pose, dims: d } = this;
    const side = SIDES[s];
    const a = pose[`${side}Ankle`];
    pose[`${side}Heel`].copy(f.heelLocal(_v)).applyQuaternion(f.q).add(a);
    pose[`${side}BigToe`]
      .set(-f.side * 0.012 * d.height, -d.ankleHeight * 0.85, d.toeFront)
      .applyQuaternion(f.q)
      .add(a);
    pose[`${side}SmallToe`]
      .set(f.side * 0.022 * d.height, -d.ankleHeight * 0.88, d.toeFront * 0.78)
      .applyQuaternion(f.q)
      .add(a);
  }

  private solveArms(dt: number) {
    const { dims: d, gait: g, torso: tf, pose } = this;
    const L = d.armLength;
    const H = d.height;
    const chestUp = _up.set(0, 1, 0).applyQuaternion(tf.qChest);
    const bodyYaw = g.root.yaw + this.stance.turn;
    const fwd = forwardOf(g.root.yaw, _f);

    for (let s = 0; s < 2; s++) {
      const side = SIDES[s];
      const sgn = s === 0 ? 1 : -1;
      const shoulder = pose[`${side}Shoulder`].copy(tf.shoulders[s]);

      // --- free arm: guard, or hanging with a pendulum swing opposite the same-side leg
      const free = _target;
      if (this.stance.guard) {
        free.set(sgn * 0.06 * H, 0.025 * H, 0.14 * H).applyQuaternion(tf.qChest).add(tf.neck);
      } else {
        const same = g.feet[s].ankle;
        const opp = g.feet[1 - s].ankle;
        const lead = ((opp.x - same.x) * fwd.x + (opp.z - same.z) * fwd.z) / (0.4 * H);
        // relaxed pendulum swing, more forward than back (upper arm ~ +22° / -14°);
        // soft saturation (tanh), a hard clamp would hold the arm still at the extremes
        const swingTarget = (Math.tanh(1.2 * lead) * lerp(0.4, 0.6, g.run) + 0.02) * g.walk * this.style.armSwing;
        const a = dt > 0 ? this.swing[s].step(swingTarget, 9, dt) : swingTarget;
        // elbow flexes more on the forward swing (~15° back, ~45° front)
        const flex = lerp(0.3 + 1.1 * Math.max(0, a) + 0.1 * g.walk, 1.5 + 0.3 * a, g.run);
        const lft = leftOf(bodyYaw, _l);
        // `a` swings the upper arm; the forearm hangs on from the elbow, flexed forward.
        // Hands hang by the thighs and swing slightly toward the midline going forward
        const fa = a + flex;
        free
          .copy(shoulder)
          .addScaledVector(fwd, Math.sin(a) * d.upperArm + Math.sin(fa) * d.forearm)
          .addScaledVector(lft, sgn * (0.012 * H - 0.05 * Math.max(0, a)));
        free.y -= Math.cos(a) * d.upperArm + Math.cos(fa) * d.forearm;
      }

      // seated: free hands rest on the thighs
      if (this.sit > 0) {
        const rest = _w.lerpVectors(tf.hips[s], pose[`${side}Knee`], 0.62);
        rest.y += 0.06 * H;
        rest.addScaledVector(leftOf(bodyYaw, _l), -sgn * 0.015 * H);
        free.lerp(rest, this.sit);
      }
      const task = this.tasks.hands[s];
      if (task) free.lerp(task.pos, task.weight);

      // --- clavicle: shrug when reaching up, protract when reaching far
      _v.subVectors(free, shoulder);
      const elev = smoothstep(-0.05, 0.6, _v.dot(chestUp) / L);
      shoulder.addScaledVector(chestUp, elev * 0.03 * H);
      const dist = _v.length();
      const protract = clamp(dist - 0.85 * L, 0, 0.035 * H) * (task ? task.weight : 0);
      if (dist > 1e-6) shoulder.addScaledVector(_v, protract / dist);

      // --- elbow swivel: blend of canonical directions by where the hand is
      // (chest frame, x = outward): hanging → back, forward → down/out,
      // overhead → forward/out, out to the side → down/back, across → out/down
      _q.copy(tf.qChest).invert();
      const dl = _v.subVectors(free, shoulder).normalize().applyQuaternion(_q);
      dl.x *= sgn;
      const wHang = Math.max(0, -dl.y);
      const wUp = Math.max(0, dl.y);
      const wFwd = Math.max(0, dl.z);
      const wOut = Math.max(0, dl.x);
      const wAcross = Math.max(0, -dl.x);
      _pole
        .set(0.12, 0, -1)
        .multiplyScalar(wHang)
        .addScaledVector(_w.set(0.4, -1, -0.15), wFwd)
        .addScaledVector(_w.set(0.12, -0.15, 1), wUp)
        .addScaledVector(_w.set(0, -1, -0.4), wOut)
        .addScaledVector(_w.set(0.7, -0.6, 0), wAcross);
      if (this.stance.guard && !task) _pole.set(0.2, -1, 0);
      _pole.x *= sgn;
      _pole.applyQuaternion(tf.qChest);
      solveTwoBone(shoulder, free, d.upperArm, d.forearm, _pole, pose[`${side}Elbow`], pose[`${side}Wrist`]);
    }
  }

  private solveHead(dt: number) {
    const { dims: d, gait: g, torso: tf, pose } = this;
    const H = d.height;
    const fwd = forwardOf(g.root.yaw, _f);

    // gaze target: explicit > hands at work > the path ahead > straight ahead
    const gazeTarget = _target;
    let hasGaze = false;
    if (this.lookAt) {
      gazeTarget.copy(this.lookAt);
      hasGaze = true;
    } else if (!this.stance.guard) {
      let w = 0;
      gazeTarget.set(0, 0, 0);
      for (let s = 0; s < 2; s++) {
        const h = this.intent.hands[s];
        if (!h) continue;
        // hands close to the chest need no visual guidance; while walking
        // people watch the path unless heading to the target itself
        const dist = h.pos.distanceTo(tf.chest);
        // (things held close to the body — a tray, a box — need no looking at)
        const k = h.weight * smoothstep(0.55, 0.85, dist) * (1 - g.walk * (1 - smoothstep(0.9, 1.6, dist)));
        gazeTarget.addScaledVector(h.pos, k);
        w += k;
      }
      if (w > 0.05) {
        gazeTarget.divideScalar(w);
        hasGaze = true;
      }
    }
    if (!hasGaze) {
      const ahead = g.walk > 0.3 ? 4.5 : 3;
      gazeTarget.set(g.root.x, g.walk > 0.3 ? 0.35 * H : 0.85 * H, g.root.z).addScaledVector(fwd, ahead);
    }
    // the head turns smoothly toward the gaze direction (angles, not a point that can
    // jump from far ahead to the hands and swing the head through it)
    const toGaze = _w.subVectors(gazeTarget, tf.headCenter);
    // within neck range of the chest, and a target right behind keeps the side the
    // head is already turning to (no flip-flopping across the back)
    const chestF = _v.set(0, 0, 1).applyQuaternion(tf.qChest);
    const chestYawW = yawOf(chestF.x, chestF.z);
    let rel = wrapAngle(yawOf(toGaze.x, toGaze.z) - chestYawW);
    const prevRel = wrapAngle(this.gazeYaw.value - chestYawW);
    if (Math.abs(rel) > 2.4 && Math.sign(rel) !== Math.sign(prevRel)) rel = -rel;
    const wantYaw = chestYawW + clamp(rel, -1.2, 1.2);
    const wantPitch = Math.atan2(-toGaze.y, Math.hypot(toGaze.x, toGaze.z));
    if (dt > 0) {
      this.gazeYaw.step(this.gazeYaw.value + wrapAngle(wantYaw - this.gazeYaw.value), 5.5, dt);
      this.gazePitch.step(wantPitch, 5.5, dt);
    } else {
      this.gazeYaw.reset(wantYaw);
      this.gazePitch.reset(wantPitch);
    }
    const gp = this.gazePitch.value;
    const gz = _gz
      .set(Math.sin(this.gazeYaw.value) * Math.cos(gp), -Math.sin(gp), Math.cos(this.gazeYaw.value) * Math.cos(gp))
      .add(tf.headCenter);

    const qHead = _q2;
    if (this.headRot) {
      qHead.copy(this.headRot);
    } else {
      // world-space gaze first: the face never tips past ~60° down (less while walking)
      const dw = _v.subVectors(gz, tf.headCenter);
      const horizW = Math.hypot(dw.x, dw.z);
      const chestFwd = _w.set(0, 0, 1).applyQuaternion(tf.qChest);
      // near-vertical gaze has no reliable direction: fall back to the chest's
      const yawBlend = smoothstep(0.1, 0.35, horizW / Math.max(1e-6, dw.length()));
      const chestYawW = yawOf(chestFwd.x, chestFwd.z);
      const worldYaw = chestYawW + wrapAngle(yawOf(dw.x, dw.z) - chestYawW) * yawBlend;
      const worldPitch = clamp(Math.atan2(-dw.y, horizW), -0.8, lerp(1.0, 0.4, smoothstep(0.15, 0.5, g.walk)));
      dw.set(Math.sin(worldYaw) * Math.cos(worldPitch), -Math.sin(worldPitch), Math.cos(worldYaw) * Math.cos(worldPitch));
      // head frame in world space: face the gaze, keep the head mostly upright
      // (a little of the trunk's lateral bend carries through), then limit neck range
      const zAx = dw.normalize();
      const upRef = _up.set(0, 1, 0).applyQuaternion(tf.qChest).multiplyScalar(0.3);
      upRef.y += 0.7;
      const xAx = _kneeTmp.crossVectors(upRef, zAx);
      if (xAx.lengthSq() < 1e-8) xAx.set(1, 0, 0).applyQuaternion(tf.qChest);
      xAx.normalize();
      const yAx = _ankleTmp.crossVectors(zAx, xAx);
      qHead.setFromRotationMatrix(_m4.makeBasis(xAx, yAx, zAx));
      const rel = _q.copy(tf.qChest).invert().multiply(qHead);
      const angle = 2 * Math.acos(clamp(Math.abs(rel.w), 0, 1));
      const maxNeck = 0.95;
      if (angle > maxNeck) {
        _q2b.copy(qHead);
        qHead.copy(tf.qChest).slerp(_q2b, maxNeck / angle);
      }
    }
    // impact snap (not for a tracked head: that is measured)
    if (!this.headRot) qHead.multiply(quatYXZ(this.headYaw.value, this.headPitch.value, 0, _q));
    headFrom(d, tf.neck, tf.qChest, qHead, pose.headBase, pose.headCenter);
    const hb = pose.headBase;
    const h = d.head;
    pose.headTop.set(...h.top).applyQuaternion(qHead).add(hb);
    pose.nose.set(...h.nose).applyQuaternion(qHead).add(hb);
    pose.leftEye.set(h.eye[0], h.eye[1], h.eye[2]).applyQuaternion(qHead).add(hb);
    pose.rightEye.set(-h.eye[0], h.eye[1], h.eye[2]).applyQuaternion(qHead).add(hb);
    pose.leftEar.set(h.ear[0], h.ear[1], h.ear[2]).applyQuaternion(qHead).add(hb);
    pose.rightEar.set(-h.ear[0], h.ear[1], h.ear[2]).applyQuaternion(qHead).add(hb);
  }
}

/** where a foot bears (or is about to bear) weight */
function supportOf(f: Foot): Vector3 | null {
  if (f.phase === 'lifted') return null;
  return f.phase === 'swing' ? f.to : f.anchor;
}

const _hold = [new Vector3(), new Vector3()];
/** where a foot supports the body: a swinging foot's support travels from lift-off to landing */
function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  const t = l2 > 1e-12 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1) : 0;
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

function footholdOf(f: Foot): Vector3 {
  if (f.phase !== 'swing') return f.anchor;
  return _hold[f.side > 0 ? 0 : 1].lerpVectors(f.anchor, f.to, smoothstep(0, 1, f.s));
}

function emptyTasks(): PostureTasks {
  return { hands: [null, null], head: null, torso: null, pelvis: null, feet: [null, null], look: null, headYaw: null, obstacles: [], stand: null, headRot: null, avoid: [], seat: null };
}

function headForward(q: Quaternion): [number, number] {
  const f = _v.set(0, 0, 1).applyQuaternion(q);
  return [f.x, f.z];
}

function oriented(e: Effector | undefined, prev: OrientedTask | null): OrientedTask | null {
  if (!e || (!e.position && !e.rotation)) return null;
  const w = clamp(e.weight ?? 1, 0, 1);
  if (w <= 0) return null;
  return {
    pos: e.position ? toVector3(e.position, prev?.pos ?? new Vector3()) : null,
    rot: e.rotation ? (prev?.rot ?? new Quaternion()).set(e.rotation.x, e.rotation.y, e.rotation.z, e.rotation.w) : null,
    weight: w,
  };
}

export type { Task };
