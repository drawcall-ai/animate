import { Quaternion, Vector3, type Object3D } from 'three';
import { FIXED_DT } from '../src/scenario';
import type { Frame } from './frame';

const DEG = 180 / Math.PI;

/** each joint class: its bones (the joint is the one at the bone's origin) */
const CLASSES = {
  trunk: ['hips', 'spine', 'chest'],
  neck: ['neck', 'head'],
  clavicle: ['leftShoulder', 'rightShoulder'],
  shoulder: ['leftUpperArm', 'rightUpperArm'],
  elbow: ['leftLowerArm', 'rightLowerArm'],
  wrist: ['leftHand', 'rightHand'],
  hip: ['leftUpperLeg', 'rightUpperLeg'],
  knee: ['leftLowerLeg', 'rightLowerLeg'],
  ankle: ['leftFoot', 'rightFoot'],
} as const;
export type JointClass = keyof typeof CLASSES;

/** a peak and where it was */
export interface RatePeak {
  value: number;
  at: number;
  joint: string;
}
const peak = (): RatePeak => ({ value: 0, at: 0, joint: '' });

/**
 * Each joint's angular velocity (°/s) and acceleration (°/s²) of the first actor, as the
 * rotation of its bone relative to its parent's (the hips: to the world), at the fixed step;
 * the peaks per joint class.
 */
export class JointRates {
  readonly velocity = Object.fromEntries(Object.keys(CLASSES).map((c) => [c, peak()])) as Record<JointClass, RatePeak>;
  readonly acceleration = Object.fromEntries(Object.keys(CLASSES).map((c) => [c, peak()])) as Record<JointClass, RatePeak>;
  /** each joint's own peaks (by bone name) */
  readonly joints: Record<string, { velocity: RatePeak; acceleration: RatePeak }> = {};
  private bones: { cls: JointClass; name: string; node: Object3D; parent: Object3D | null; last: Quaternion | null; omega: Vector3 | null }[] | null = null;

  see({ t, h }: Frame) {
    h.model.scene.updateMatrixWorld(true);
    this.bones ??= Object.entries(CLASSES).flatMap(([cls, names]) =>
      names.map((name) => {
        const node = h.model.scene.getObjectByName(name);
        if (!node) throw new Error(`the character model has no ${name}`);
        return { cls: cls as JointClass, name, node, parent: name === 'hips' ? null : node.parent, last: null, omega: null };
      }),
    );
    for (const b of this.bones) {
      const q = b.node.getWorldQuaternion(new Quaternion());
      if (b.parent) q.premultiply(b.parent.getWorldQuaternion(_p).invert());
      if (b.last) {
        // ω from the turn since the last step, in the joint's own frame
        const d = _d.copy(b.last).invert().multiply(q);
        if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
        const s = Math.hypot(d.x, d.y, d.z);
        const angle = 2 * Math.atan2(s, d.w);
        const omega = new Vector3(d.x, d.y, d.z).multiplyScalar(s > 1e-12 ? angle / s / FIXED_DT : 0);
        const own = (this.joints[b.name] ??= { velocity: peak(), acceleration: peak() });
        const v = omega.length() * DEG;
        see(this.velocity[b.cls], v, t, b.name);
        see(own.velocity, v, t, b.name);
        if (b.omega) {
          const a = (_v.subVectors(omega, b.omega).length() * DEG) / FIXED_DT;
          see(this.acceleration[b.cls], a, t, b.name);
          see(own.acceleration, a, t, b.name);
        }
        b.omega = omega;
      }
      b.last = q;
    }
  }

  toString() {
    const row = (c: JointClass) => {
      const v = this.velocity[c];
      const a = this.acceleration[c];
      return `${c} ${v.value.toFixed(0)}°/s (${v.joint} @${v.at.toFixed(2)}s), ${(a.value / 1000).toFixed(1)}k°/s² (${a.joint} @${a.at.toFixed(2)}s)`;
    };
    return `joint rates: ${(Object.keys(CLASSES) as JointClass[]).map(row).join('; ')}`;
  }
}

function see(p: RatePeak, v: number, t: number, joint: string) {
  if (v <= p.value) return;
  p.value = v;
  p.at = t;
  p.joint = joint;
}

const _p = new Quaternion();
const _d = new Quaternion();
const _v = new Vector3();
