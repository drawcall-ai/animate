import { Quaternion, Vector3 } from 'three';

/** mulberry32 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a random rotation up to `angle` (rad) */
export function turnUpTo(rand: () => number, angle: number): Quaternion {
  const axis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
  return new Quaternion().setFromAxisAngle(axis, angle * rand());
}
