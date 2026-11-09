import { Object3D, Vector3 } from 'three';
import type { Digit, Finger, Thumb } from '../fingers/shape';

/** A direction or place on a grip: in the empty's frame. */
type Vec = Vector3 | readonly [number, number, number];

/**
 * What a grip asks of the hand. A grip declares what of the hand's placement is fixed and what is free; the hand verb taking it picks the
 * rest as it starts, from where the body stands, and keeps it on the thing while it holds it. What the grip fixes the arm holds exactly;
 * what was picked within its freedoms is only preferred — the hand keeps its point on the empty and turns off the picked turn where its wrist
 * cannot hold it. With nothing asked, the empty is where the palm's middle goes, the hand turned as the arm brings it and kept turned as it
 * took hold. A creature's tip takes the empty's position alone. In a model, these are the empty's `userData` (GLB extras).
 */
export interface Grip {
  /** a handle running through the empty: an axis, pointing out of the fist at the thumb's end; the palm against it and the fingers round it,
   * rolling freely about it (with `facing`, its palm fixed so: the grip fully fixed) */
  handle?: Vec;
  /** the way the touching point (the palm, or the pad) faces into the thing; it rolls freely about it */
  facing?: Vec;
  /** with a handle, how far the palm lies off the axis (m; default measured off the thing's meshes about the empty); without one, a ball
   * about the empty, the palm anywhere on it facing its middle (with `facing`, there) */
  radius?: number;
  /** how far the hand slides along a handle, centred on the empty (m): a rail, a rope, a long rung */
  length?: number;
  /** the digit whose pad goes on the empty instead of the palm's middle (a fingertip on a button): the hand comes as a loose fist, points
   * before its last run in along `facing`, holds where the pad meets the face and draws back the way it came */
  point?: Digit;
  /** digits laid over the hand closed on the thing: a digit's values, or the name of an empty on the thing its pad presses on (read every
   * update; that empty's own `facing` lays the pad flat on its face) */
  digits?: Partial<Record<Digit, string | Finger | Thumb>>;
}

/**
 * Adds a grip to `thing`: an empty named `name` at `at` (in the thing's frame), its `userData` from `spec`. Returns the empty, to turn or
 * parent further. The thing itself takes `userData.mass` (kg; without it, it cannot be lifted) and `userData.centre` (where its mass is,
 * its own frame; default its origin).
 */
export function grip(thing: Object3D, name: string, at: Vec, spec: Grip = {}): Object3D {
  const empty = new Object3D();
  empty.name = name;
  if (at instanceof Vector3) empty.position.copy(at);
  else empty.position.set(...at);
  Object.assign(empty.userData, spec);
  thing.add(empty);
  return empty;
}
