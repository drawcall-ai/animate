import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { Track, type Humanoid, type Proportions } from '@prohuman/core';
import { handOf, jointOf } from '../joints';
import { forwardOf, quatYXZ, vec, wrapAngle } from '../math';
import type { Effector, ScenarioInput } from '../scenario';

// Shared by the riding scenes: a vehicle travelling over the ground, and hand and foot rotations.

export const GRAVITY = 9.81;

/**
 * A vehicle's way over the ground: its speed and the path's curvature are given tick by tick
 * (m/s, 1/m, + = turning left); it integrates where it is and which way it heads, and leans
 * into the turn as a bicycle must (atan(v²κ / g)).
 */
export class Travel {
  readonly position = new Vector3();
  yaw = 0;
  speed = 0;
  curvature = 0;
  /** the travelled distance (m) */
  s = 0;

  constructor(x = 0, z = 0, yaw = 0) {
    this.position.set(x, 0, z);
    this.yaw = yaw;
  }

  step(speed: number, curvature: number, dt: number) {
    this.speed = speed;
    this.curvature = curvature;
    this.s += speed * dt;
    this.yaw += speed * curvature * dt;
    this.position.addScaledVector(forwardOf(this.yaw), speed * dt);
  }

  /** the lean a balanced two-wheeler takes in the turn (rad, + = to the left) */
  get lean() {
    return Math.atan((this.speed * this.speed * this.curvature) / GRAVITY);
  }
}

/** a curvature ramping in over `ramp` m from `from`, and out again from `to` (1/m) */
export const bend = (s: number, from: number, to: number, radius: number, ramp: number) => (smooth(from, from + ramp, s) - smooth(to, to + ramp, s)) / radius;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _x = new Vector3();
const _q = new Quaternion();
const matrix = new Matrix4();
const _y = new Vector3();
const _z = new Vector3();

/**
 * A hand's world rotation (the VRM hand bone's: at rest the fingers point out along ±x, the
 * palm down) for the fingers pointing along `fingers` and the palm facing `palm` (world
 * directions, made square); `side` 1 = left, −1 = right.
 */
export function handRotation(fingers: Vector3, palm: Vector3, side: number, out = new Quaternion()): Quaternion {
  const x = _x.copy(fingers).normalize().multiplyScalar(side);
  const y = _y.copy(palm).addScaledVector(x, -palm.dot(x)).normalize().negate();
  return out.setFromRotationMatrix(matrix.makeBasis(x, y, _z.crossVectors(x, y)));
}

/** a foot's world rotation in a vehicle's frame `frame`: turned `yaw`, pitched `pitch` (+ = toes up) */
export const footRotation = (frame: Quaternion, yaw: number, pitch: number, out = new Quaternion()) => out.copy(frame).multiply(quatYXZ(yaw, -pitch, 0, _q));


/** values keyed over time (s), each along a core Track: quintic from key to key, no overshoot */
export class Keys {
  private readonly tracks: Track[];

  constructor(n: number) {
    this.tracks = Array.from({ length: n }, () => new Track());
  }

  key(t: number, ...v: number[]): this {
    if (v.length !== this.tracks.length) throw new Error(`${v.length} values keyed on ${this.tracks.length} tracks`);
    v.forEach((x, i) => this.tracks[i].key(t, x));
    return this;
  }

  at(t: number): number[] {
    return this.tracks.map((k) => k.at(t));
  }
}

/** an ankle key [x, y, z, yaw, pitch, roll] of a flat foot raised onto its ball by `pitch` (rad, < 0), the ball where it was */
export function onBall(k: number[], pitch: number, p: Proportions): number[] {
  const ball = p.offsets.leftToes;
  const at = vec(k[0], k[1], k[2]).add(vec(0, ball.y, ball.z).applyQuaternion(quatYXZ(k[3])));
  at.sub(vec(0, ball.y, ball.z).applyQuaternion(quatYXZ(k[3], -pitch)));
  return [at.x, at.y, at.z, k[3], pitch, k[5]];
}

/** a vehicle's input once on it: its mount, and the seat and contacts on it */
export type Riding = ScenarioInput & { mount: NonNullable<ScenarioInput['mount']> };

/** the effectors a boarding keys, in the order of `Boarding.onto` */
const CONTACTS = ['leftFoot', 'rightFoot', 'leftHand', 'rightHand'] as const;

/**
 * Getting on or into a vehicle: each effector's way keyed in the vehicle's frame (m, rad; s
 * from the start), its first keys where the body is as it begins (`from`), the rest where the
 * vehicle's entry points put it. The hips: [x, y, z, yaw, pitch, roll]; the ankles: [x, y, z,
 * yaw, pitch (+ = toes up), roll]; the wrists: [x, y, z, fingers (x, y, z), palm (x, y, z),
 * weight]; the chest, bent over the hips: [pitch, roll, twist, weight]; the gaze: [x, y, z]; `carry`: [how far the vehicle carries the body (its mount's
 * weight), how firmly the hips are held] — as the hips let go, the seat takes them; `onto`:
 * how far each contact (left foot, right foot, left hand, right hand) has gone over to its
 * riding target (a pedal turning, a grip steering).
 */
export class Boarding {
  readonly hips = new Keys(6);
  readonly feet = [new Keys(6), new Keys(6)] as const;
  readonly hands = [new Keys(10), new Keys(10)] as const;
  readonly chest = new Keys(4);
  readonly look = new Keys(3);
  readonly carry = new Keys(2);
  readonly onto = new Keys(4);
  /** the body as it begins, in the vehicle's frame (yaws nearest `facing`; the hands free) */
  readonly from: { hips: number[]; feet: number[][]; hands: number[][] };

  constructor(h: Humanoid, local: (w: Vector3) => Vector3, frame: Quaternion, facing: number) {
    const inv = frame.clone().invert();
    const f = vec(0, 0, 1).applyQuaternion(frame);
    const turn = (yaw: number) => facing + wrapAngle(yaw - Math.atan2(f.x, f.z) - facing);
    const hand = (side: 'left' | 'right') => {
      const { position, quaternion } = handOf(h, side);
      const q = quaternion.premultiply(inv);
      return [...local(position).toArray(), ...vec(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(q).toArray(), ...vec(0, -1, 0).applyQuaternion(q).toArray(), 0];
    };
    this.from = {
      hips: [...local(jointOf(h, 'hips')).toArray(), turn(h.yaw), 0, 0],
      feet: h.feet.map((ft, i) => [...local(jointOf(h, i === 0 ? 'leftFoot' : 'rightFoot')).toArray(), turn(ft.yaw), 0, 0]),
      hands: [hand('left'), hand('right')],
    };
    this.onto.key(0, 0, 0, 0, 0);
    this.chest.key(0, 0, 0, 0, 0);
    const o = h.proportions.offsets;
    this.trunk = o.spine.y + o.chest.y;
  }

  /** the chest bone's origin over the hips' (m) */
  private readonly trunk: number;

  /**
   * The input `u` s in: `ride`'s mount, weighted by how far it carries the body; the keyed
   * contacts going over to `ride`'s; the keyed gaze; `ride`'s seat as the hips let go.
   */
  input(u: number, at: (v: Vector3) => Vector3, frame: Quaternion, ride: Riding): ScenarioInput {
    const [carry, firm] = this.carry.at(u);
    const k = firm > 0 ? this.hips.at(u) : this.from.hips;
    const foot = (k: number[]): Effector => ({ position: at(vec(k[0], k[1], k[2])), quaternion: footRotation(frame, k[3], k[4]).multiply(quatYXZ(0, 0, k[5])) });
    const hand = (k: number[], side: number): Effector => ({
      position: at(vec(k[0], k[1], k[2])),
      quaternion: handRotation(vec(k[3], k[4], k[5]), vec(k[6], k[7], k[8]), side).premultiply(frame),
      weight: k[9],
    });
    const keyed = [foot(this.feet[0].at(u)), foot(this.feet[1].at(u)), hand(this.hands[0].at(u), 1), hand(this.hands[1].at(u), -1)];
    const onto = this.onto.at(u);
    const look = this.look.at(u);
    const [lean, roll, twist, bent] = this.chest.at(u);
    const chest = frame.clone().multiply(quatYXZ(k[3] + twist, k[4] + lean, k[5] + roll));
    const input: ScenarioInput = {
      mount: { ...ride.mount, weight: carry },
      hips: firm > 0 ? { position: at(vec(k[0], k[1], k[2])), quaternion: frame.clone().multiply(quatYXZ(k[3], k[4], k[5])), weight: firm } : undefined,
      chest: bent > 0 ? { position: at(vec(k[0], k[1], k[2])).add(vec(0, this.trunk, 0).applyQuaternion(chest)), quaternion: chest, weight: bent } : undefined,
      seat: firm < 1 ? ride.seat : undefined,
      lookAt: at(vec(look[0], look[1], look[2])),
    };
    CONTACTS.forEach((n, i) => {
      const e = keyed[i];
      const to = ride[n];
      if (to && onto[i] > 0) {
        e.position.lerp(to.position, onto[i]);
        if (e.quaternion && to.quaternion) e.quaternion.slerp(to.quaternion, onto[i]);
        e.weight = MathUtils.lerp(e.weight ?? 1, to.weight ?? 1, onto[i]);
      }
      if ((e.weight ?? 1) > 0) input[n] = e;
    });
    return input;
  }
}
