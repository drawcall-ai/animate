import { Object3D, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import type { Self } from '../body/runtime';
import type { Goal } from '../kernel/goal';
import { bodyOf, hangsFrom } from '../things/hold';
import { resolve } from '../things/resolve';
import { Carrier } from '../kernel/carrier';

/**
 * Where a verb goes: a point (`Vector3`), a place that moves with its parent and sets the orientation too (an `Object3D`: an empty, a
 * bone), or either as it is at each of the body's sub-steps (a function of the body's time, s). An object is read eased across the
 * update from where the app last left it; an object a function returns is read as the function leaves it, each sub-step. A body is no
 * target — a hand or a walk goes to a place on it (one of its bones, an empty parented to one) — but `lookAt` takes one, meaning its eyes.
 */
export type Target = Vector3 | Object3D | ((time: number) => Vector3 | Object3D);

/** A target as a body finds it in a sub-step: where, turned how (an `Object3D`'s; none for a point), moving how fast (if known), and the
 * object it is, if it is one. */
interface Found extends Goal {
  object?: Object3D;
}

/** `target` as `self` finds it each sub-step (once a sub-step: read again in the same sub-step, as it was) */
export function finder(self: Self, target: Target): (f: Frame) => Found {
  const found: Found = { position: new Vector3() }, turn = new Quaternion(), velocity = new Vector3(), placed = { position: new Vector3(), quaternion: new Quaternion() };
  // (a function's object as it leaves it each sub-step, not eased across the update as the app moving it once an update would be)
  let made: Carrier | null = null;
  const fresh = (at: Object3D, time: number) => {
    resolve(self, at, placed, true);
    if (made) made.move(time, placed.position, placed.quaternion);
    else (made = new Carrier(placed.position, placed.quaternion)).place(time, placed.position, placed.quaternion);
    return made;
  };
  let time = NaN;
  return (f) => {
    if (time === f.time) return found;
    time = f.time;
    const at = typeof target === 'function' ? target(f.time) : target;
    if (at instanceof Vector3) {
      if (![at.x, at.y, at.z].every(Number.isFinite)) throw new Error(`a target that is no point: (${at.x}, ${at.y}, ${at.z})`);
      return Object.assign(found, { position: found.position.copy(at), quaternion: undefined, velocity: undefined, object: undefined, carriedBy: undefined });
    }
    const on = bodyOf(at);
    if (on) self.meet(on);
    const frame = typeof target === 'function' ? fresh(at, f.time) : self.track(at);
    found.position.copy(frame.current.position);
    found.quaternion = turn.copy(frame.current.quaternion);
    found.velocity = frame.velocity(velocity);
    found.object = at;
    found.carriedBy = on && hangsFrom(on, at) >= 0 ? on : undefined;
    return found;
  };
}
