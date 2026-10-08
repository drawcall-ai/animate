import { Vector3 } from 'three';
import type { CharacterModel } from '@pmndrs/viverse';
import type { FootPhase } from './gait/foot';
import { Gait } from './gait/gait';
import { GaitOverlay } from './gait/overlay';
import type { Input, Options, Style } from './input';
import { Intent } from './intent/intent';
import { tracksBody } from './intent/tasks';
import { Arms } from './limbs/arms';
import { Head } from './limbs/head';
import { Legs } from './limbs/legs';
import { smoothstep, type Vec3 } from './math';
import { createHolds, Dynamics } from './pose/dynamics';
import { createFrames } from './pose/frames';
import { createPose, movePose, writePose } from './pose/pose';
import { Planner } from './posture/plan';
import { Settle } from './posture/settle';
import { P, recoilVelocity, trunkFK } from './posture/trunk';
import type { Proportions } from './proportions';
import { Rig } from './rig';
import { defaultStance, type Stance } from './stance';

/** simulation step; longer updates are sub-stepped */
const MAX_STEP = 1 / 60;
/**
 * A push's recoil, in rad/s per m/s of Δv (a solid punch, ~0.45 m/s, snaps the head at
 * ~7 rad/s). At the head: the head snaps back or aside, the trunk follows a little. At
 * the chest: the trunk folds around the hit, the head nods.
 */
const HEAD_SNAP = 15.6;
const HEAD_TRUNK = 3.3;
const CHEST_FOLD = 6.7;
const CHEST_NOD = 4.4;
/** how long a foot takes to turn flat as it is put down (s) */
const SET_DOWN = 0.12;

/** Where a foot stands or, mid-step, will land. */
export interface Foot {
  /** flat-foot ankle position */
  position: Vector3;
  yaw: number;
  /** planted: bearing weight here; swing: stepping here (also a foot target striding low and away, being put down here); lifted: held up by a foot target (returns here); carried: standing here on a mount */
  phase: FootPhase;
}

/**
 * A procedural body driven by sparse targets, posing a @pmndrs/viverse character model
 * (`loadCharacterModel`, or `createSkeletonModel`). Each tick: read the input into tasks →
 * plan where to stand → walk there (gait) → solve the trunk posture where the feet are and
 * settle it through springs → roll the feet, pose the legs, arms and head → write the pose
 * to the model's bones, with `model.scene` placed where the body stands (in world space:
 * add it to the scene itself, not to a moved parent).
 *
 * The model's proportions are measured from its rest pose. Every joint becomes a node of the
 * model named after it: the VRM-named bones (a VRM, whose bones go by other names, gets a
 * node at each) and the landmarks, added to their bones: nose, headTop, leftEye, leftEar,
 * leftHeel, leftBigToe, leftSmallToe (and right…). One Humanoid per model.
 */
export class Humanoid {
  /** measured from the model's rest pose */
  readonly proportions: Proportions;
  private readonly pose = createPose();
  private readonly rig: Rig;
  private feetOut: [Foot, Foot] = [newFoot(), newFoot()];
  /** [left, right]; read-only */
  readonly feet: readonly [Readonly<Foot>, Readonly<Foot>] = this.feetOut;

  private stance: Stance;
  private gait: Gait;
  private intent: Intent;
  private planner: Planner;
  private overlay: GaitOverlay;
  private settle: Settle;
  private legs: Legs;
  private arms: Arms;
  private head: Head;
  private frames = createFrames();
  private dynamics = new Dynamics();
  private holds = createHolds();

  constructor(
    readonly model: CharacterModel,
    options: Options = {},
  ) {
    const rig = (this.rig = new Rig(model));
    const d = (this.proportions = rig.proportions);
    const stance = (this.stance = { ...defaultStance(d), ...options.stance });
    const style: Style = { hips: 1, armSwing: 1, ...options.style };
    const tf = this.frames.trunk;
    const j = this.pose.joints;
    const gait = (this.gait = new Gait(d, stance, options.accel ?? 1.2));
    const intent = (this.intent = new Intent(d, options.maxSpeed ?? 1.3, gait, [j.leftUpperArm, j.rightUpperArm]));
    const { tasks } = intent;
    this.planner = new Planner(d, stance, tasks, gait);
    this.overlay = new GaitOverlay(d, style);
    this.settle = new Settle(d, stance, gait, tasks, this.overlay, intent.tracker);
    this.legs = new Legs(d, stance, tf, gait);
    this.arms = new Arms(d, stance, style, tf, gait, tasks.reach, intent.tracker);
    this.head = new Head(d, stance.guard, tf, gait, tasks, this.overlay);
    const { x, z } = options.position ?? { x: 0, z: 0 };
    const yaw = options.yaw ?? 0;
    gait.reset(x, z, yaw);
    this.planner.reset(x, z, yaw);
    this.settle.reset(x, z, yaw);
    this.head.reset(yaw);
    this.solvePose(0);
    rig.write(this.pose, 0);
  }

  /** the body's ground velocity (m/s); read-only */
  get velocity(): Readonly<Vector3> {
    return this.gait.velocity;
  }

  /** the body's facing: yaw about +Y (0 faces +Z) */
  get yaw(): number {
    return this.gait.root.yaw;
  }

  /** riding a mount */
  get mounted(): boolean {
    return this.gait.mount.owns;
  }

  /** how far the body is seated (0 standing … 1 seated) */
  get seated(): number {
    return this.intent.seat.sit;
  }

  /** Advance by `dt` seconds toward what `input` asks for, and pose the model. */
  update(dt: number, input: Input = {}) {
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    for (let i = 0; i < steps; i++) this.step(input, dt / steps);
    this.rig.write(this.pose, dt);
  }

  /**
   * A hit or shove that changes the body's velocity by `velocity` (m/s; the horizontal
   * part moves the body — ~0.25 is a jab, ~0.5 a solid punch, beyond that it staggers).
   * The head (`at` 'head') or trunk ('chest') recoils and settles; the gait catches the body.
   * The change is the whole body's: the recoil carries its share, the ground velocity the rest.
   */
  push(velocity: Vec3, at: 'head' | 'chest' = 'chest') {
    const yaw = this.gait.root.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const fwd = velocity.x * sin + velocity.z * cos;
    const left = velocity.x * cos - velocity.z * sin;
    const head = at === 'head';
    const pitch = head ? fwd * HEAD_TRUNK : -fwd * CHEST_FOLD;
    const roll = -left * (head ? HEAD_TRUNK : CHEST_FOLD);
    if (head) this.head.push(-fwd * HEAD_SNAP, left * HEAD_SNAP);
    else this.head.push(fwd * CHEST_NOD, 0);
    // one momentum: what the recoil carries of the change, the root doesn't
    const recoil = recoilVelocity(this.frames.trunk, pitch, roll, _recoil);
    const dvx = velocity.x - recoil.x;
    const dvz = velocity.z - recoil.z;
    this.overlay.push(pitch, roll, dvx, dvz);
    this.gait.push(dvx, dvz);
  }

  private step(input: Input, dt: number) {
    const { gait: g, intent } = this;
    const drop = this.settle.value[P.DROP];
    intent.read(input, dt, drop);
    const { tasks, steer } = intent;

    // (riding, the mount decides where the body goes)
    if (tasks.mount) this.planner.reset(g.root.x, g.root.z, g.root.yaw);
    else if (intent.active) this.planner.update(drop, steer.eager, intent.seat.holdsBody, dt);
    else this.planner.idle();
    steer.eager ||= this.planner.movingOff;

    g.update(dt, this.planner.target, steer, tasks.feet, tasks.mount);
    intent.seat.update(dt, g);

    this.overlay.update(g, tracksBody(tasks), dt);
    this.settle.update(tasks.head ? this.legs.lift : 0, dt);

    this.solvePose(dt);
  }

  private solvePose(dt: number) {
    const { proportions: d, gait: g, overlay: ov, frames, intent, stance } = this;
    const { tasks } = intent;
    const settled = this.settle.value;
    // (riding, the legs give under the mount's jolts — the posture doesn't stand up against it; a seat carries the pelvis)
    const level = g.root.y + g.mount.sink * (1 - intent.seat.sit);
    trunkFK(settled, d, stance, frames.trunk, ov, tasks.headRot, level);
    this.legs.updateLift(settled[P.DROP], dt);
    if (this.legs.lift < 0) trunkFK(settled, d, stance, frames.trunk, ov, tasks.headRot, this.legs.lift + level);
    g.roll(frames.trunk.upperLegs, dt);
    this.legs.solve(tasks.bodyObstacles, frames.sides, dt);
    this.arms.solve(intent.seat.sit, frames.sides, dt);
    this.head.solve(frames.head, dt);
    writePose(frames, d, this.rig.landmarks, g.root, this.pose);
    this.dynamics.apply(this.pose, this.hold(dt), this.rig.landmarks, dt);
    // (a flying body's centre of mass is exactly where its flight has it)
    if (g.jump.carry(g, this.pose.joints, _carry)) movePose(this.pose, _carry);
    g.capture.observe(this.pose.joints, dt, g.steer.lean);
    for (let s = 0; s < 2; s++) {
      const f = g.feet[s];
      const out = this.feetOut[s];
      const swing = f.phase === 'swing';
      // (a foot target striding low and away is a step too: it lands where it is being put down)
      const put = f.phase === 'lifted' && f.striding > 0.5 ? f.support() : null;
      out.position.copy(swing ? f.swing.to : (put ?? f.anchor));
      out.yaw = swing ? f.swing.toYaw : f.yaw;
      out.phase = put ? 'swing' : f.phase;
    }
  }

  /**
   * What the joints' dynamics keep as solved: hands on their targets (and turned as asked),
   * the feet where the gait puts them (turned as it does, standing), a tracked trunk and head.
   */
  private hold(dt: number) {
    const { holds: h, intent, gait: g } = this;
    const { tasks } = intent;
    for (let s = 0; s < 2; s++) {
      h.arms[s].at = this.arms.held[s];
      h.arms[s].turn = this.frames.sides[s].hand?.weight ?? 0;
      const f = g.feet[s];
      h.legs[s].at = 1;
      h.legs[s].bear = f.phase === 'planted' ? 1 : 0;
      // (a swinging foot is turned as it lands, a raised one by its ankle's own dynamics up in the
      // air and as solved near the floor, its toes clear of it; one let go of in the air turns flat
      // as it is set down, not in a tick)
      const H = this.proportions.height;
      const turn =
        f.phase === 'swing' ? smoothstep(0.6, 1, f.swing.s) : f.phase === 'lifted' ? 1 - smoothstep(0.03 * H, 0.09 * H, f.pose.ankle.y - f.anchor.y) : 1;
      h.legs[s].turn = dt > 0 ? Math.min(turn, h.legs[s].turn + dt / SET_DOWN) : turn;
    }
    h.body = Math.max(tasks.head?.weight ?? 0, tasks.chest?.weight ?? 0, tasks.hips?.weight ?? 0, tasks.headRot ? 1 : 0);
    return h;
  }
}

const _recoil = new Vector3();
const _carry = new Vector3();

const newFoot = (): Foot => ({ position: new Vector3(), yaw: 0, phase: 'planted' });
