import { Quaternion, Vector3 } from 'three';
import { clamp, lerp, minimumJerk, quatYXZ, smoothstep, Spring } from '../math';
import type { Proportions } from '../proportions';

/** planted: bearing weight on the ground; swing: stepping; lifted: held up by a foot target; carried: standing on a mount's foot target */
export type FootPhase = 'planted' | 'swing' | 'lifted' | 'carried';

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const _holds = [new Vector3(), new Vector3()];

/**
 * How far along its path (0 → 1) a swinging foot is at swing progress `s`: slow as it leaves
 * the floor, fastest late, slowing into the heel strike (CMU mocap from the toes leaving the
 * floor, walking and running alike: 0.18 at s = 0.3, 0.39 at 0.5, 0.8 at 0.8). Stepping
 * `over` something, the foot is carried over it early, then set down.
 */
export const swingProgress = (s: number, over: boolean) =>
  over ? minimumJerk(Math.pow(s, 0.8)) : s + s * (1 - s) * (-0.66 - 0.78 * s + 2.44 * s * s);

/**
 * The ankle's rise above its straight path at swing progress `s`, peak 1: s^a (1 − s)^b, as the
 * knee flexes (CMU mocap: walking peaks at s ≈ 0.38, running — the heel toward the buttock — at 0.47).
 */
export function swingHump(s: number, run: number): number {
  const t = clamp(s, 0, 1);
  const a = lerp(1.5, 1.7, run);
  const b = lerp(2.5, 1.9, run);
  const top = a / (a + b);
  return (Math.pow(t, a) * Math.pow(1 - t, b)) / (Math.pow(top, a) * Math.pow(1 - top, b));
}

/** A step in the air: from lift-off to landing. */
export class Swing {
  /** progress 0 → 1 */
  s = 0;
  duration = 0.4;
  /** apex clearance of the arc (m) */
  lift = 0.08;
  /** ankle height this swing must clear at its apex (0: nothing to step over) */
  clear = 0;
  /** the foot is carried over early, then set down: stepping over something, or up or down onto other ground */
  early = false;
  /** swing progress over which the foot passes above the obstacle */
  overOn = 0;
  overOff = 1;
  /** how far the swing is over the obstacle (0 … 1 on its plateau): the foot is held level */
  over = 0;
  /** body speed this step carries (m/s): one step per step time (Infinity: not limited) */
  pace = Infinity;
  /** the ankle at lift-off */
  readonly from = new Vector3();
  fromYaw = 0;
  /** the flat-foot ankle position it lands at */
  readonly to = new Vector3();
  toYaw = 0;
  /** foot pitch at heel strike (+ = toes up) */
  strikePitch = 0;
}

/** Where the foot is this tick, before leg IK: ankle and orientation. */
interface FootPose {
  readonly ankle: Vector3;
  /** + = toes up (dorsiflexion at heel strike), − = heel raised */
  pitch: number;
  /** the toes' own pitch: flat on the floor while the heel is up, relaxing into line with the foot as it swings */
  toePitch: number;
  readonly quaternion: Quaternion;
}

/**
 * One foot as the gait moves it: its contact (where it bears weight and for how long), the
 * swing that is carrying it, and the pose that results. Offsets are in the foot frame,
 * relative to the ankle.
 */
export class GaitFoot {
  phase: FootPhase = 'planted';
  /** flat-foot ankle position of the current (or, mid-swing, last) support placement */
  readonly anchor = new Vector3();
  /** heading: the placement's, turning with the swing while in the air */
  yaw = 0;
  plantedTime = 10;
  /** where the foot stands or, mid-swing, lands: what the other foot's step is judged from */
  get footing(): Vector3 {
    return this.phase === 'swing' ? this.swing.to : this.anchor;
  }
  /** pitch the foot landed with: the heel rocker rolls it flat */
  landPitch = 0;
  /** lifted: how far the foot target holds it up, the pitch the foot left the floor with, how far it is pointed (0..1) */
  liftWeight = 0;
  liftPitch = 0;
  pointed = 0;
  /** lifted: where its ankle left the floor (heel up as it stood) */
  readonly liftFrom = new Vector3();
  /** how long a foot target has waited for the weight to come off this foot (s) */
  liftWait = 0;
  /** yaw before a lift (the lifted foot) or a kick's pivot (the support foot) */
  pivotBase = 0;
  /** lifted: how far it is striding — carried low and away, to be put down there (0..1) */
  striding = 0;
  private readonly putDown = new Vector3();
  /** planted by a stride (until it steps again) */
  strided = false;
  /** lifted: how far its stride has carried the body (m, x and z) */
  readonly carry = [new Spring(), new Spring()] as const;
  /** lifted: the share of its stride the body goes along */
  carryShare = 0;
  /** how far the knee turns out to its own side, about the vertical (rad): a leg brought up beside the body */
  kneeOut = 0;
  readonly swing = new Swing();
  readonly pose: FootPose = { ankle: new Vector3(), pitch: 0, toePitch: 0, quaternion: new Quaternion() };

  constructor(
    readonly side: 1 | -1,
    private d: Proportions,
  ) {}

  /** local contact points (foot frame, from the ankle) */
  heelLocal(out: Vector3) {
    const h = this.d.sole.heel;
    return out.set(this.side * h.x, h.y, h.z);
  }
  /** the ball of the foot: the toes bone's origin */
  ballLocal(out: Vector3) {
    return out.copy(this.side > 0 ? this.d.offsets.leftToes : this.d.offsets.rightToes);
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

  /** the pose's orientation from the heading and pitch */
  orient() {
    quatYXZ(this.yaw, -this.pose.pitch, 0, this.pose.quaternion);
  }

  /** where this foot bears (or is about to bear) weight; null while lifted (unless striding: where it is being put down) */
  support(): Vector3 | null {
    if (this.phase === 'lifted') return this.striding > 0.5 ? this.putDown.set(this.pose.ankle.x, this.anchor.y, this.pose.ankle.z) : null;
    return this.phase === 'swing' ? this.swing.to : this.anchor;
  }

  /** where this foot holds the body sideways: a swinging foot's hold travels from lift-off to landing */
  foothold(): Vector3 {
    if (this.phase !== 'swing') return this.anchor;
    return _holds[this.side > 0 ? 0 : 1].lerpVectors(this.anchor, this.swing.to, smoothstep(0, 1, this.swing.s));
  }
}
