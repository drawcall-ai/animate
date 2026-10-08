import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Proportions } from '../proportions';
import type { Gait } from '../gait/gait';
import { groundAt } from '../gait/obstacles';
import type { GaitOverlay } from '../gait/overlay';
import type { Tasks } from '../intent/tasks';
import { clamp, forwardOf, framePoint, hypot, lerp, Pendulum, quatYXZ, smoothstep, Spring, wrapAngle, yawOf } from '../math';
import { sightLine, type Sight } from '../posture/terms/hands';
import { headFrom } from '../posture/trunk';
import { createHeadFrame, type HeadFrame, type TrunkFrame } from '../pose/frames';

/** how far the head may turn relative to the chest (rad) */
const MAX_NECK = 0.95;
/**
 * The share of the thorax's gait swing the head goes along with, the neck taking out the
 * rest: ~50% of its rotation, ~65% of its roll (CMU mocap; the chest's roll already carries 30%).
 */
const CARRY = { yaw: 0.5, roll: 0.35 };
/** riding, the eyes are on the way ahead: this far (m) plus this long (s) of travel, into the turn by where it heads this long ahead (s, at most rad) */
const RIDE_AHEAD = { near: 3, time: 1.2, turn: 0.8, most: 0.9 };
/** gaze-direction following rate (1/s) */
const GAZE_RATE = 5.5;
/** sighting, how far the head nods down and cants onto the stock at most (rad), how quickly it settles there (1/s), and how far above the line of sight the eye rests (× height) */
const WELD = { nod: 0.45, cant: 0.35, rate: 10, above: 0.008 };

const _gaze = new Vector3();
const _dir = new Vector3();
const _v = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _head = new Quaternion();
const _sight: Sight = { origin: new Vector3(), dir: new Vector3(), rear: 0 };
const _welded = createHeadFrame();
const _eye = new Vector3();
const _r0 = new Vector3();
const _r1 = new Vector3();
const _r2 = new Vector3();

/**
 * The head: turns smoothly toward what the body attends to (explicit gaze > hands at work
 * > the path ahead > straight ahead), within neck range and mostly upright; a hit snaps
 * it back and it settles.
 */
export class Head {
  private gazeYaw = new Spring();
  private gazePitch = new Spring();
  private snapPitch = new Pendulum(11, 0.45);
  private snapYaw = new Pendulum(11, 0.45);
  /** sighting: the head's nod and cant onto the stock (rad) */
  private nod = new Spring();
  private cant = new Spring();

  constructor(
    private d: Proportions,
    /** idle hands keep a guard: the eyes stay ahead, not on the hands */
    private guard: boolean,
    private tf: TrunkFrame,
    private gait: Gait,
    private tasks: Tasks,
    private overlay: GaitOverlay,
  ) {}

  reset(yaw: number) {
    this.gazeYaw.reset(yaw);
    this.gazePitch.reset(0.1);
  }

  /** a hit snaps the head (rad/s, + pitch = nod down, + yaw = turn left) */
  push(pitchRate: number, yawRate: number) {
    this.snapPitch.velocity += pitchRate;
    this.snapYaw.velocity += yawRate;
  }

  /** poses the neck and head into `out` */
  solve(out: HeadFrame, dt: number) {
    const { tf } = this;
    // a tracked head orientation (VR) is used as measured
    const headRot = this.tasks.headRot;
    if (dt > 0) {
      this.snapPitch.step(0, dt);
      this.snapYaw.step(0, dt);
    }
    this.followGaze(dt);
    const gp = this.gazePitch.value;
    const gy = this.gazeYaw.value;
    const gaze = _dir.set(Math.sin(gy) * Math.cos(gp), -Math.sin(gp), Math.cos(gy) * Math.cos(gp));
    const qHead = headRot ? _head.copy(headRot) : this.orient(gaze);
    // impact snap and a cheek weld (not for a tracked head: that is measured)
    if (!headRot) this.weld(qHead, dt);
    if (!headRot) qHead.multiply(quatYXZ(this.snapYaw.value, this.snapPitch.value, 0, _q));
    headFrom(this.d, tf.neck, tf.qChest, qHead, out);
  }

  /**
   * Sighting along something aimed in both hands (a rifle): the head nods down and cants
   * onto the stock — the neck flexing with it — until the rear hand's eye is on the line of
   * sight, as far as a neck goes (a cheek weld).
   */
  private weld(qHead: Quaternion, dt: number) {
    const { tasks: t, tf, d } = this;
    const [a, b] = t.reach;
    const w = t.look && a && b ? sightLine(a, b, t.look, tf.eyes, d, _sight) : 0;
    let nod = 0;
    let cant = 0;
    if (w > 0) {
      // (Gauss–Newton on the eye's offset across the line)
      // (+x is the head's left: a + roll lowers its right side)
      const toward = _sight.rear === 0 ? -1 : 1;
      const eye = _eye.set(-toward * d.head.eye.x, d.head.eye.y, d.head.eye.z);
      const h = 1e-3;
      for (let i = 0; i < 3; i++) {
        const r = this.offLine(qHead, nod, cant, eye, _r0);
        const jn = this.offLine(qHead, nod + h, cant, eye, _r1).sub(r).divideScalar(h);
        const jc = this.offLine(qHead, nod, cant + h, eye, _r2).sub(r).divideScalar(h);
        const nn = jn.dot(jn) + 1e-6;
        const cc = jc.dot(jc) + 1e-6;
        const nc = jn.dot(jc);
        const gn = jn.dot(r);
        const gc = jc.dot(r);
        const det = nn * cc - nc * nc;
        nod = clamp(nod - (cc * gn - nc * gc) / det, 0, WELD.nod);
        // (canted toward the stock only: the rear hand's side down)
        cant = clamp(cant - (nn * gc - nc * gn) / det, toward < 0 ? -WELD.cant : 0, toward > 0 ? WELD.cant : 0);
      }
    }
    if (dt > 0) {
      this.nod.step(nod * w, WELD.rate, dt);
      this.cant.step(cant * w, WELD.rate, dt);
    } else {
      this.nod.reset(nod * w);
      this.cant.reset(cant * w);
    }
    if (this.nod.value !== 0 || this.cant.value !== 0) qHead.multiply(quatYXZ(0, this.nod.value, this.cant.value, _q));
  }

  /** where the eye at `eye` (in the head's frame) is off the line of sight, across it, the head nodded and canted by that much */
  private offLine(qHead: Quaternion, nod: number, cant: number, eye: Vector3, out: Vector3): Vector3 {
    const q = _q2.copy(qHead).multiply(quatYXZ(0, nod, cant, _q));
    headFrom(this.d, this.tf.neck, this.tf.qChest, q, _welded);
    framePoint(out, _welded.head, q, eye).sub(_sight.origin);
    out.y -= WELD.above * this.d.height;
    return out.addScaledVector(_sight.dir, -out.dot(_sight.dir));
  }

  /**
   * The gaze direction turns smoothly toward the target (angles, not a point that can jump
   * from far ahead to the hands and swing the head through it).
   */
  private followGaze(dt: number) {
    const { tf } = this;
    const toGaze = _v.subVectors(this.gazeTarget(_gaze), tf.headCenter);
    // within neck range of the chest, and a target right behind keeps the side the
    // head is already turning to (no flip-flopping across the back)
    const chestF = _x.set(0, 0, 1).applyQuaternion(tf.qChest);
    const chestYaw = yawOf(chestF.x, chestF.z);
    let rel = wrapAngle(yawOf(toGaze.x, toGaze.z) - chestYaw);
    const prevRel = wrapAngle(this.gazeYaw.value - chestYaw);
    if (Math.abs(rel) > 2.4 && Math.sign(rel) !== Math.sign(prevRel)) rel = -rel;
    const wantYaw = chestYaw + clamp(rel, -1.2, 1.2);
    const wantPitch = Math.atan2(-toGaze.y, hypot(toGaze.x, toGaze.z));
    if (dt > 0) {
      this.gazeYaw.step(this.gazeYaw.value + wrapAngle(wantYaw - this.gazeYaw.value), GAZE_RATE, dt);
      this.gazePitch.step(wantPitch, GAZE_RATE, dt);
    } else {
      this.gazeYaw.reset(wantYaw);
      this.gazePitch.reset(wantPitch);
    }
  }

  /** what the eyes are on: explicit > hands at work > the path ahead > straight ahead; riding, the way ahead */
  private gazeTarget(out: Vector3): Vector3 {
    const { tf, gait: g, tasks } = this;
    const H = this.d.height;
    if (tasks.look) return out.copy(tasks.look);
    if (g.move.owns) return out.copy(g.move.look);
    if (g.mount.owns) {
      // (where it goes: along its travel — down a slope too — into the turn, the facing blended in as it slows)
      const { velocity: v, turn, position } = g.mount;
      const speed = g.speed;
      const dir = _x.copy(v).addScaledVector(forwardOf(g.root.yaw, out), 1 - smoothstep(0.3, 1, speed)).normalize();
      dir.applyAxisAngle(_up.set(0, 1, 0), clamp(turn * RIDE_AHEAD.turn, -RIDE_AHEAD.most, RIDE_AHEAD.most));
      return out.set(g.root.x, position.y, g.root.z).addScaledVector(dir, RIDE_AHEAD.near + RIDE_AHEAD.time * speed);
    }
    if (!this.guard) {
      let w = 0;
      out.set(0, 0, 0);
      for (const h of tasks.hands) {
        if (!h) continue;
        // hands close to the chest need no visual guidance (things held close to the
        // body — a tray, a box — need no looking at); while walking people watch the
        // path unless heading to the target itself
        const dist = h.pos.distanceTo(tf.chest);
        const k = h.weight * smoothstep(0.55, 0.85, dist) * (1 - g.walk * (1 - smoothstep(0.9, 1.6, dist)));
        out.addScaledVector(h.pos, k);
        w += k;
      }
      if (w > 0.05) return out.divideScalar(w);
    }
    // walking, the path a few steps ahead; standing, ahead a little below eye level (the
    // head slightly forward): one blends into the other with the walk
    const w = smoothstep(0.1, 0.6, g.walk);
    const ground = groundAt(g.steer.ground, g.root.x, g.root.z);
    return out.set(g.root.x, ground + lerp(0.75, 0.35, w) * H, g.root.z).addScaledVector(forwardOf(g.root.yaw, _x), lerp(3, 4.5, w));
  }

  /** head orientation for a world gaze direction: face it, keep the head mostly upright, limit neck range */
  private orient(gaze: Vector3): Quaternion {
    const { tf, gait: g } = this;
    // world-space gaze first: the face never tips past ~60° down (less while walking)
    const horiz = hypot(gaze.x, gaze.z);
    const chestF = _x.set(0, 0, 1).applyQuaternion(tf.qChest);
    const chestYaw = yawOf(chestF.x, chestF.z);
    // near-vertical gaze has no reliable direction: fall back to the chest's
    const yawBlend = smoothstep(0.1, 0.35, horiz / Math.max(1e-6, gaze.length()));
    const yaw = chestYaw + wrapAngle(yawOf(gaze.x, gaze.z) - chestYaw) * yawBlend + CARRY.yaw * this.overlay.thoraxYaw;
    const pitch = clamp(Math.atan2(-gaze.y, horiz), -0.8, lerp(1.0, 0.4, smoothstep(0.15, 0.5, g.walk)));
    // head frame in world space: face the gaze, keep the head mostly upright
    // (a little of the trunk's lateral bend carries through), then limit neck range
    const zAx = _v.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
    const upRef = _up.set(0, 1, 0).applyQuaternion(tf.qChest).multiplyScalar(0.3);
    upRef.y += 0.7;
    const xAx = _x.crossVectors(upRef, zAx);
    if (xAx.lengthSq() < 1e-8) xAx.set(1, 0, 0).applyQuaternion(tf.qChest);
    xAx.normalize();
    const yAx = _y.crossVectors(zAx, xAx);
    const qHead = _head.setFromRotationMatrix(_m.makeBasis(xAx, yAx, zAx)).multiply(quatYXZ(0, 0, CARRY.roll * this.overlay.thoraxRoll, _q));
    const rel = _q.copy(tf.qChest).invert().multiply(qHead);
    const angle = 2 * Math.acos(clamp(Math.abs(rel.w), 0, 1));
    if (angle > MAX_NECK) {
      _q2.copy(qHead);
      qHead.copy(tf.qChest).slerp(_q2, MAX_NECK / angle);
    }
    return qHead;
  }
}
