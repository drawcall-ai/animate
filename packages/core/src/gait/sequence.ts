import { Matrix4, type Quaternion, Vector3 } from 'three';
import type { HandTask } from '../intent/tasks';
import { quintic } from '../math';
import type { Gait, Root } from './gait';

interface Key {
  t: number;
  v: number;
  dv: number;
  ddv: number;
}

/**
 * A curve through keys (time s, value): quintic from key to key, passing each at its given
 * rate and acceleration, or else still at the ends, turns and holds and at the harmonic mean
 * of the slopes around it between (monotone: no overshoot). Held at the last key after it.
 */
export class Track {
  private readonly keys: Key[] = [];

  /** no keys yet */
  get empty(): boolean {
    return this.keys.length === 0;
  }

  clear(): this {
    this.keys.length = 0;
    return this;
  }

  key(t: number, v: number, dv = NaN, ddv = 0): this {
    const last = this.keys[this.keys.length - 1];
    if (last && !(t > last.t)) throw new Error(`track keys out of order: ${t} after ${last.t}`);
    this.keys.push({ t, v, dv, ddv });
    return this;
  }

  at(t: number): number {
    const k = this.keys;
    if (t <= k[0].t) return k[0].v;
    if (t >= k[k.length - 1].t) return k[k.length - 1].v;
    let i = 1;
    while (i < k.length - 1 && t > k[i].t) i++;
    const a = k[i - 1];
    const b = k[i];
    return quintic(a.v, this.rate(i - 1), a.ddv, b.v, this.rate(i), b.ddv, b.t - a.t, t - a.t);
  }

  private rate(i: number): number {
    const k = this.keys;
    if (!Number.isNaN(k[i].dv)) return k[i].dv;
    if (i === 0 || i === k.length - 1) return 0;
    const s0 = (k[i].v - k[i - 1].v) / (k[i].t - k[i - 1].t);
    const s1 = (k[i + 1].v - k[i].v) / (k[i + 1].t - k[i].t);
    return s0 * s1 <= 0 ? 0 : (2 * s0 * s1) / (s0 + s1);
  }
}


/** a foot's way through a sequence: ankle out from the edge, up, across; its pitch, its toes' and its knee's turn-out (rad) */
export const footTracks = () => ({ along: new Track(), up: new Track(), across: new Track(), pitch: new Track(), toes: new Track(), out: new Track() });

const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();

/** a hand's world rotation (into `out`) with its fingers along `fingers` and its palm facing `palm`, for `side` (+1 left; VRM hands at rest point out along ±x, the palms down) */
export function handRotation(fingers: Vector3, palm: Vector3, side: number, out: Quaternion): Quaternion {
  const x = _x.copy(fingers).multiplyScalar(side);
  const y = _y.copy(palm).negate();
  return out.setFromRotationMatrix(_m.makeBasis(x, y, _z.crossVectors(x, y)));
}

/**
 * A traversal the gait infers from the ground and obstacles on the way (climbing onto a box,
 * vaulting a wall): approached by the walk, then played out along key poses warped to the
 * edge and the body, owning the root, the feet and the hands while under way. Its trunk lean,
 * roll and free-arm swing are layered on by the gait overlay and the arms.
 */
export interface Move {
  /** under way: it owns the root, the feet and the hands */
  readonly owns: boolean;
  /** trunk lean and roll (rad; + = raises the left side), free-arm shoulder flexion (rad), how far the planted heels are raised (rad) */
  readonly lean: number;
  readonly roll: number;
  readonly arm: number;
  readonly heel: number;
  /** where the eyes are on while under way */
  readonly look: Vector3;
  /** a hand's hold (null while it is free) */
  hold(s: number): HandTask | null;
  reset(): void;
  /** the target to walk to: `target`, or the spot the move starts from */
  aim(g: Gait, target: Root): Root;
  /** advance a move under way; false while there is none */
  update(g: Gait, dt: number): boolean;
  /** the hip joints as posed this tick ([left, right]): under way, the feet it carries are posed */
  pose(g: Gait, hips: readonly [Vector3, Vector3]): void;
}
