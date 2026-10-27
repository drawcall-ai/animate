import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import type { Self } from '../body/runtime';
import type { Goal } from '../kernel/goal';
import { bodyOf } from '../things/hold';

/**
 * Where a verb goes: a point (`Vector3`), a place that moves with its parent and sets the orientation too (an `Object3D`: an empty, a
 * bone), or either as it is at each of the body's sub-steps (a function of the body's time, s).
 */
export type Target = Vector3 | Object3D | ((time: number) => Vector3 | Object3D);

/** A target as a body finds it in a sub-step: where, turned how (an `Object3D`'s; none for a point), moving how fast (if known), and the
 * object it is, if it is one. */
export interface Found extends Goal {
  object?: Object3D;
}

/** `target` as `self` finds it each sub-step (once a sub-step: read again in the same sub-step, as it was) */
export function finder(self: Self, target: Target): (f: Frame) => Found {
  const found: Found = { position: new Vector3() };
  const turn = new Quaternion(), velocity = new Vector3();
  let time = NaN;
  return (f) => {
    if (time === f.time) return found;
    time = f.time;
    const at = typeof target === 'function' ? target(f.time) : target;
    if (at instanceof Vector3) {
      if (![at.x, at.y, at.z].every(Number.isFinite)) throw new Error(`a target that is no point: (${at.x}, ${at.y}, ${at.z})`);
      return Object.assign(found, { position: found.position.copy(at), quaternion: undefined, velocity: undefined, object: undefined });
    }
    const on = bodyOf(at);
    if (on) self.meet(on);
    const frame = self.track(at);
    found.position.copy(frame.current.position);
    found.quaternion = turn.copy(frame.current.quaternion);
    found.velocity = frame.velocity(velocity);
    found.object = at;
    return found;
  };
}


