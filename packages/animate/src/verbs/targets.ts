import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/frame';
import type { Self } from '../body/self';
import { headingOf } from '../core/math';

/**
 * Where a verb goes: a point (`Vector3`), a place that moves with its parent and sets the orientation too (an `Object3D`: an empty, a
 * bone), or either as it is at each of the body's sub-steps (a function of the body's time, s).
 */
export type Target = Vector3 | Object3D | ((time: number) => Vector3 | Object3D);

/** A target as a body finds it in a sub-step: where, turned how (an `Object3D`'s; none for a point), and moving how fast (if known). */
export interface Found {
  position: Vector3;
  quaternion: Quaternion | null;
  velocity: Vector3 | undefined;
  /** the object it is, if it is one */
  object: Object3D | null;
}

/** `target` as `self` finds it each sub-step (once a sub-step: read again in the same sub-step, as it was) */
export function finder(self: Self, target: Target): (f: Frame) => Found {
  const found: Found = { position: new Vector3(), quaternion: null, velocity: undefined, object: null };
  let time = NaN;
  return (f) => {
    if (time === f.time) return found;
    time = f.time;
    const at = typeof target === 'function' ? target(f.time) : target;
    if (at instanceof Vector3) {
      if (![at.x, at.y, at.z].every(Number.isFinite)) throw new Error(`a target that is no point: (${at.x}, ${at.y}, ${at.z})`);
      return Object.assign(found, { position: found.position.copy(at), quaternion: null, velocity: undefined, object: null });
    }
    const frame = self.track(at);
    found.position.copy(frame.current.position);
    found.quaternion = (found.quaternion ?? new Quaternion()).copy(frame.current.quaternion);
    found.velocity = frame.velocity(found.velocity ?? new Vector3());
    found.object = at;
    return found;
  };
}

/** the facing (rad about +Y) an orientation's +Z points along */
export function headingOfTurn(quaternion: Readonly<Quaternion>): number {
  const forward = _forward.set(0, 0, 1).applyQuaternion(quaternion);
  return headingOf(forward.x, forward.z);
}

const _forward = new Vector3();
