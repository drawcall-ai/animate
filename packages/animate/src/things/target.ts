import { Object3D, Quaternion, Vector3 } from 'three';
import { sameThree } from '../kernel/math';
import { topOf } from '../kernel/scene';
import type { Frame } from '../kernel/frame';
import type { Self } from '../body/self';
import type { Goal } from '../kernel/goal';
import { bodyOf, boneOf } from './hold';
import { placedFor } from './placed';
import { MovingFrame } from '../kernel/moving-frame';

/**
 * Where a verb goes: a point (`Vector3`), a place that moves with its parent and sets the orientation too (an `Object3D`: an empty, a
 * bone), or either as it is at each of the body's sub-steps (a function of the body's time, s). An `Object3D` turns a person's hand to its
 * own world turn (a `reach`'s only as far as the wrist goes) as from the T-pose: unturned, the fingers point out along the arm (+X for the left hand, −X for the right), palm down;
 * turned ±π/2 about +Y (left −, right +), they point ahead. An object is read eased across the
 * update from where the app last left it; an object a function returns is read as the function leaves it, each sub-step. A target the
 * body walks to (or a placement it stands at) is on the body's floor: its x and z say where, the floor's height there is where it
 * stands; one it reaches or looks at is the world point it is. A body is no target — a hand or a walk goes to a place on it (one of its
 * bones, an empty parented to one) — but `lookAt` takes one (or a function giving one), meaning its eyes.
 */
export type Target = Vector3 | Object3D | ((time: number) => Vector3 | Object3D);

/**
 * `target` as a hand's (`verb` going there): an empty a hand holds by — a handle (`userData.handle`) or a digit's pad (`userData.point`) —
 * is a grip, the hand placed from where it holds it, which only `grab` does; a hand reaching or tracked there would put its wrist on it, a
 * misuse said at once
 */
export function handTarget(target: Target, verb: string): Target {
  if (!(target instanceof Object3D)) return target;
  const { handle, point } = target.userData, key = handle !== undefined ? 'handle' : point !== undefined ? 'point' : null;
  if (key) throw new Error(`${verb}: "${target.name}" has userData.${key}, a grip: a hand goes onto it with grab, placed from where it holds it`);
  return target;
}

/** A target as a body finds it in a sub-step: where, turned how (an `Object3D`'s; none for a point), moving how fast (if known), and the
 * object it is, if it is one. */
/** a target as found: where it is, and the object it is, if one */
export interface Found extends Goal {
  object?: Object3D;
}

/** `target` as `self` finds it each sub-step (once a sub-step: read again in the same sub-step, as it was) */
export function finder(self: Self, target: Target): (f: Frame) => Found {
  sameThree(target);
  const found: Found = { position: new Vector3() }, turn = new Quaternion(), velocity = new Vector3(), placed = { position: new Vector3(), quaternion: new Quaternion() };
  // (a function's object as it leaves it each sub-step, not eased across the update as the app moving it once an update would be)
  let made: MovingFrame | null = null;
  const fresh = (at: Object3D, time: number) => {
    placedFor(self, at, placed, true);
    if (made) made.move(time, placed.position, placed.quaternion);
    else (made = new MovingFrame(placed.position, placed.quaternion)).place(time, placed.position, placed.quaternion);
    return made;
  };
  let time = NaN, inScene: Object3D | null = null, hung: Object3D | null = null;
  return (f) => {
    if (time === f.time) return found;
    time = f.time;
    const at = typeof target === 'function' ? sameThree(target(f.time)) : target;
    if (at instanceof Vector3) {
      if (![at.x, at.y, at.z].every(Number.isFinite)) throw new Error(`a target that is no point: (${at.x}, ${at.y}, ${at.z})`);
      return Object.assign(found, { position: found.position.copy(at), quaternion: undefined, velocity: undefined, object: undefined, carriedBy: undefined });
    }
    // (taken out of the body's scene, itself or with what it hangs from, or off what it hung from, whichever tree that was in, while still a
    // target: its numbers now mean nowhere, so it stands where it was last, said once; put back, it goes on. One never in that scene and
    // hanging from nothing is a place of its own numbers: a function's object is the app's to place each sub-step)
    const shared = topOf(at) === topOf(self.object);
    if (((inScene === at && !shared) || (hung === at && !at.parent)) && typeof target !== 'function') {
      self.warn(`target gone ${at.uuid}`, `the target "${at.name}" was taken out of the scene while a verb still goes to it, or a hand it brought something to still keeps to it: it stays where it was. Remove it after the next verb on that hand has ended`);
      found.velocity = undefined;
      found.carriedBy = undefined;
      return found;
    }
    inScene = shared ? at : null;
    hung = at.parent ? at : null;
    const on = bodyOf(at);
    if (on) self.meet(on);
    const frame = typeof target === 'function' ? fresh(at, f.time) : self.movingFrameOf(at);
    found.position.copy(frame.current.position);
    found.quaternion = turn.copy(frame.current.quaternion);
    found.velocity = frame.velocity(velocity);
    found.object = at;
    found.carriedBy = on && boneOf(on, at) >= 0 ? on : undefined;
    return found;
  };
}
