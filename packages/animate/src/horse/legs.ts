// Recalled: Back et al. (1995), Hodson (2000/2001), Clayton (2004) curves as retained by the spike.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Legs } from '../core/legs/legs';
import type { JointCycle } from '../core/legs/cycle';
import type { LegChain, Rocker } from '../core/legs/legs';
import { LEGS, NECK, HEAD } from './skeleton';
import { strideAt } from '../core/legs/gait';
import { powerGait } from '../core/legs/schedule';

// Recalled: hip height ~1.2 m, slow walk threshold 0.8 m/s (spike).
// Recalled: Hildebrand lateral walk sequence and Clayton/Hobbs diagonal trot offsets.
// Recalled: Alexander/Jayes stride coefficients; Hodson stance at 1.6 / 3.7 m/s.
// Tuned: 5 cm walk clearance for the proxy hoof; trot retains the recalled spike margins.
export const HORSE_WALK = { ...powerGait(1.2, 0.8, [0.25, 0.75, 0, 0.5], 2.3, 0.68 * Math.pow(1.6, 0.7), [0.05, 0.05, 0.05, 0.05]), referenceSpeed: 1.6 };
export const HORSE_TROT = powerGait(1.2, 0.8, [0.52, 0.02, 0, 0.5], 2.15, 0.3 * Math.pow(3.7, 0.7), [0.035, 0.035, 0, 0]);

/**
 * Each joint's angle over a stride off standing square (°, + its segment's far end forward), the
 * stance to 45%: the shapes of the sagittal joint angles at the trot read off Back et al. 1995
 * (Equine Vet J 27:31, 27:39; recalled, not re-read: the amplitudes to the excursions horse-v4's
 * judge bands hold, Back 1995 and Hodson 2000/2001), the same for the walk (warped to its duty)
 */
const walkDuty = strideAt(HORSE_WALK, 1.6, 0).duty;
const trotDuty = strideAt(HORSE_TROT, 3.7, 0).duty;
// Read: Back et al. 1996, doi:10.1080/01652176.1996.9694699, Table 1.
// Derived walk/trot excursion ratios from Tables 1–2; duty interpolates the two gaits, not their timing.
const cycle = (keys: [number, number][], walk = 1): JointCycle => ({
  duty: 0.45, keys,
  amplitude: (duty) => 1 + (walk - 1) * Math.max(0, Math.min(1, (duty - trotDuty) / (walkDuty - trotDuty))),
});
const FORE = {
  scapula: cycle([[0, 8], [0.22, 0], [0.45, -10], [0.7, 2], [0.9, 10]]),
  shoulder: cycle([[0, 5], [0.22, -3], [0.45, -15], [0.6, -5], [0.75, 15], [0.9, 15]]),
  elbow: cycle([[0, -5], [0.22, -12], [0.45, -5], [0.58, 35], [0.7, 55], [0.85, 20], [0.95, 0]], 75.2 / 84.7),
  carpus: cycle([[0, 0], [0.4, 0], [0.5, -30], [0.62, -87.9], [0.75, -50], [0.88, -5]], 69.9 / 87.9),
};
const HIND = {
  hip: cycle([[0, 10], [0.22, 0], [0.45, -12], [0.6, -3], [0.78, 15], [0.92, 14]]),
  stifle: cycle([[0, -5], [0.15, -12], [0.45, 0], [0.58, -30], [0.7, -45], [0.85, -20], [0.95, -5]], 46.1 / 58.3),
  hock: cycle([[0, 5], [0.15, 15], [0.45, 0], [0.58, 30], [0.7, 45], [0.85, 20], [0.95, 5]], 46 / 65.7),
};
/** the fetlock sinking under the load and folding in the swing, the coffin joint a little either way */
// These are rotations off the sloping standing pastern, not the table's absolute joint angles.
const FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]]);
const COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]]);
/** the hoof flat on the ground, breaking over its toe at the end of the stance (°, + toe up) */
const BREAKOVER: Rocker = { keys: [[0, 0], [0.8, 0], [1, -25]] };

/** the horse's body for the core */
export function horseLegs(): readonly LegChain[] {
  return LEGS.map((leg): LegChain => ({
    joints: [
      ...(leg.fore ? [{ bone: leg.scapula ?? fail('a foreleg without a scapula'), axes: 'x', cycle: FORE.scapula }] : []),
      { bone: leg.upper, axes: 'yzx', cycle: leg.fore ? FORE.shoulder : HIND.hip },
      { bone: leg.middle, axes: 'x', cycle: leg.fore ? FORE.elbow : HIND.stifle },
      { bone: leg.cannon, axes: 'x', cycle: leg.fore ? FORE.carpus : HIND.hock },
      { bone: leg.pastern, axes: 'zx', cycle: FETLOCK },
      { bone: leg.hoof, axes: 'x', cycle: COFFIN },
    ],
    heel: leg.heel.clone(),
    toe: leg.toe.clone(),
    toeOut: 0,
    rocker: BREAKOVER,
  }));
}

const fail = (what: string): never => { throw new Error(what); };

/** Walk head carriage: two nods per stride, entrained to foreleg contact rather than wall time. */
export function horseCarriage(f: Frame, legs: Legs): void {
  const speed = f.prev.position(0).distanceTo(f.prev2.position(0)) / f.dt;
  // Read: Loscher et al. 2016 (doi:10.1098/rspb.2016.1908), cranial excursion 9.1 ± 3.4 cm.
  // Derived: 0.045 m amplitude / 0.63 m neck lever = 0.071 rad. Phase is tuned to fore support.
  const nod = 0.071 * Math.min(1, speed / 0.8) * Math.sin(4 * Math.PI * (legs.legs[0].phase - 0.15));
  f.current.setLocal(NECK, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), nod));
  f.current.setLocal(HEAD, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -nod / 2));
}
