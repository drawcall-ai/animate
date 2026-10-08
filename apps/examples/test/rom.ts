import { Quaternion, type Object3D } from 'three';
import { beyondRange, type BoneName } from '@prohuman/core';
import type { Frame } from './frame';

const DEG = 180 / Math.PI;
/** the joints with a range: each at its bone's origin */
const JOINTS: BoneName[] = ['spine', 'chest', 'neck', 'head'];
for (const s of ['left', 'right'] as const) JOINTS.push(`${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`, `${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`);

/** a joint's worst excursion and when */
export interface Excursion {
  value: number;
  at: number;
}

/**
 * Each joint's range of motion (the core's table, clinical norms) against the first actor's
 * model: how far each bone's rotation in its parent's frame goes beyond its joint's range (°).
 */
export class RangeOfMotion {
  readonly joints: Record<string, Excursion> = {};
  private bones: { name: BoneName; node: Object3D; parent: Object3D }[] | null = null;

  see({ t, h }: Frame) {
    h.model.scene.updateMatrixWorld(true);
    this.bones ??= JOINTS.map((name) => {
        const node = h.model.scene.getObjectByName(name);
        if (!node?.parent) throw new Error(`the character model has no ${name}`);
        return { name, node, parent: node.parent };
      });
    for (const b of this.bones) {
      const q = b.parent.getWorldQuaternion(_p).invert().multiply(b.node.getWorldQuaternion(_q));
      const v = beyondRange(b.name, q) * DEG;
      const j = (this.joints[b.name] ??= { value: 0, at: 0 });
      if (v > j.value) [j.value, j.at] = [v, t];
    }
  }

  /** the worst excursion of all and where */
  get worst(): Excursion & { joint: string } {
    let w = { value: 0, at: 0, joint: '' };
    for (const [joint, j] of Object.entries(this.joints)) if (j.value > w.value) w = { ...j, joint };
    return w;
  }

  toString() {
    const out = Object.entries(this.joints).filter(([, j]) => j.value > 0.05);
    return `range of motion: ${out.length ? out.map(([n, j]) => `${n} +${j.value.toFixed(1)}° @${j.at.toFixed(2)}s`).join(', ') : 'within'}`;
  }
}

const _p = new Quaternion();
const _q = new Quaternion();
