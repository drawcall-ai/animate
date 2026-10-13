import { Quaternion, type Object3D } from 'three';
import { BONES, ranges, type BoneName } from '@drawcall/animate';
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
 * Each joint's range of motion (the humanoid's `ranges`, clinical norms) against the first actor's
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

const RANGES = new Map(ranges().map((r) => [BONES[r.bone], r]));

/**
 * a swing this far round (rad) nears the turn opposite the joint's axis, where its twist is
 * undefined: the twist's range opens up from here to there
 */
const TWIST_FADE = 0.75 * Math.PI;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * How far `q`, `bone`'s rotation in its parent's frame, is beyond its range (rad; 0 within it):
 * the most any of the swing's two components and the twist (Baerlocher & Boulic 2001) is past its
 * limit, the twist's range opening up as the swing nears the opposite turn.
 */
function beyondRange(bone: BoneName, q: Quaternion): number {
  const r = RANGES.get(bone);
  if (!r) throw new Error(`no range of motion for ${bone}`);
  const p = _r.copy(q);
  if (r.neutral) p.multiply(_n.copy(r.neutral).invert());
  const sg = p.w < 0 ? -1 : 1;
  const c = [sg * p.x, sg * p.y, sg * p.z];
  const w = sg * p.w;
  const i = r.axis;
  const j = (i + 1) % 3;
  const k = (i + 2) % 3;
  // q = swing · twist: the twist is q's part about the axis, the swing q · twist⁻¹
  const tl = Math.sqrt(c[i] * c[i] + w * w);
  const a = tl > 1e-9 ? c[i] / tl : 0;
  const b = tl > 1e-9 ? w / tl : 1;
  const sj = b * c[j] - a * c[k];
  const sk = b * c[k] + a * c[j];
  const sl = Math.sqrt(sj * sj + sk * sk);
  const phi = 2 * Math.atan2(sl, w * b + c[i] * a);
  const f = sl > 1e-9 ? phi / sl : 2;
  const tau = 2 * Math.atan2(a, b);
  const out = (v: number, [lo, hi]: [number, number]) => Math.max(0, v - hi, lo - v);
  const [lo, hi] = r.twist;
  const fade = smooth((phi - TWIST_FADE) / (Math.PI - TWIST_FADE));
  const twist: [number, number] = [lo - (Math.PI + lo) * fade, hi + (Math.PI - hi) * fade];
  return Math.max(out(sj * f, r.swing[0]), out(sk * f, r.swing[1]), out(tau, twist));
}

const _r = new Quaternion();
const _n = new Quaternion();
