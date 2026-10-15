// Recalled: Back et al. (1995), Hodson (2000/2001), Clayton (2004) curves as retained by the spike.
import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import type { Legs } from '../core/legs/legs';
import type { JointCycle } from '../core/legs/cycle';
import type { LegChain, Rocker } from '../core/legs/legs';
import { LEGS, NECK, HEAD } from './skeleton';
import { powerGait } from '../core/legs/schedule';

// Recalled: hip height ~1.2 m, slow walk threshold 0.8 m/s (spike).
// Recalled: Hildebrand lateral walk sequence and Clayton/Hobbs diagonal trot offsets.
// Recalled: Alexander/Jayes stride coefficients; Hodson stance at 1.6 / 3.7 m/s.
// Tuned: 5 cm walk clearance for the proxy hoof; trot retains the recalled spike margins.
const walk = powerGait(1.2, 0.8, [0.25, 0.75, 0, 0.5], 2.3, 0.68 * Math.pow(1.6, 0.7), [0.05, 0.05, 0.05, 0.05]);
export const HORSE_WALK = {
  ...walk, referenceSpeed: 1.6, referenceBlend: 1,
  // Tuned from the read 28% fore-cannon crossing, allowing for the coffin's forward offset.
  contacts: walk.contacts.map((contact, i) => ({ ...contact, stanceCenter: i < 2 ? 0.31 : undefined })),
};
export const HORSE_TROT = powerGait(1.2, 0.8, [0.52, 0.02, 0, 0.5], 2.15, 0.3 * Math.pow(3.7, 0.7), [0.035, 0.035, 0, 0]);

// Read: Back et al. 1995 fore/hind abstracts describe TROT at 4 m/s, not walk.
// Recalled: Back et al. 1996 comparison: walk stance has less shoulder/stifle/hock flexion.
// Read: Hodson et al. 2001 abstract (doi:10.2746/042516401776767485): loading
// flexion in the first 10%, stifle flexion after 28%, coordinated stifle/hock swing.
// Recalled: trot curves below and the 1996 excursion values retained from the spike.
// Read: Hodson et al. 2000 (doi:10.2746/042516400777032237): fore cannon vertical at 28% stride.
// Tuned: walk keys implement those findings; they are not digitised paper data.
const cycle = (keys: [number, number][], alternate: [number, number][] = keys): JointCycle => ({ duty: 0.45, keys, alternate });
const FORE = {
  scapula: cycle([[0, 8], [0.22, 0], [0.45, -10], [0.7, 2], [0.9, 10]]),
  shoulder: cycle([[0, 5], [0.22, -3], [0.45, -15], [0.6, -5], [0.75, 15], [0.9, 15]]),
  elbow: cycle([[0, -5], [0.22, -12], [0.45, -5], [0.58, 35], [0.7, 55], [0.85, 20], [0.95, 0]],
    [[0, -5], [0.22, -12], [0.45, -5], [0.58, 35 * 75.2 / 84.7], [0.7, 55 * 75.2 / 84.7], [0.85, 20 * 75.2 / 84.7], [0.95, 0]]),
  carpus: cycle([[0, 0], [0.4, 0], [0.5, -30], [0.62, -87.9], [0.75, -50], [0.88, -5]],
    [[0, 0], [0.4, 0], [0.5, -30 * 66 / 87.9], [0.62, -66], [0.75, -50 * 66 / 87.9], [0.88, -5 * 66 / 87.9]]),
};
const HIND = {
  hip: cycle([[0, 10], [0.22, 0], [0.45, -12], [0.6, -3], [0.78, 15], [0.92, 14]]),
  stifle: cycle([[0, -5], [0.15, -12], [0.45, 0], [0.58, -30], [0.7, -45], [0.85, -20], [0.95, -5]],
    [[0, 0], [0.07, -3], [0.22, 0], [0.45, -3], [0.58, -22], [0.7, -34], [0.85, -15], [0.95, 0]]),
  hock: cycle([[0, 5], [0.15, 15], [0.45, 0], [0.58, 30], [0.7, 45], [0.85, 20], [0.95, 5]],
    [[0, 0], [0.07, 3], [0.22, 0], [0.45, 3], [0.58, 22], [0.7, 34], [0.85, 15], [0.95, 0]]),
};
// Tuned walk: spring under load, then a modest pastern fold. The trot's large
// fetlock fold was turning the whole free hoof under, rather than clearing it.
const FORE_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, -30 * 35 / 55], [0.68, -35], [0.82, -20 * 35 / 55], [0.95, 0]]);
const FORE_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 8], [0.8, 4]]);
const HIND_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, -20], [0.68, -30], [0.82, -10], [0.95, 0]]);
const HIND_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 25], [0.8, 10]]);
/** the hoof flat on the ground, breaking over its toe at the end of the stance (°, + toe up) */
// Tuned: finish the toe roll before lift-off, braking the downward spin inherited by swing.
const BREAKOVER: Rocker = { keys: [[0, 0], [0.75, 0], [0.9, -25], [1, -25]] };

/** the horse's body for the core */
export function horseLegs(): readonly LegChain[] {
  return LEGS.map((leg): LegChain => ({
    joints: [
      ...(leg.fore ? [{ bone: leg.scapula ?? fail('a foreleg without a scapula'), axes: 'x', cycle: FORE.scapula }] : []),
      { bone: leg.upper, axes: 'yzx', cycle: leg.fore ? FORE.shoulder : HIND.hip },
      { bone: leg.middle, axes: 'x', cycle: leg.fore ? FORE.elbow : HIND.stifle },
      { bone: leg.cannon, axes: 'x', cycle: leg.fore ? FORE.carpus : HIND.hock },
      { bone: leg.pastern, axes: 'zx', cycle: leg.fore ? FORE_FETLOCK : HIND_FETLOCK },
      { bone: leg.hoof, axes: 'x', cycle: leg.fore ? FORE_COFFIN : HIND_COFFIN },
    ],
    heel: leg.heel.clone(),
    toe: leg.toe.clone(),
    toeOut: 0,
    rocker: BREAKOVER,
  }));
}

const fail = (what: string): never => { throw new Error(what); };

/** Walk head carriage: two nods per stride, entrained to foreleg contact rather than wall time. */
export function horseCarriage(f: Frame, legs: Legs, person?: Readonly<Vector3>): void {
  const speed = f.prev.position(0).distanceTo(f.prev2.position(0)) / f.dt;
  // Read: Loscher et al. 2016 (doi:10.1098/rspb.2016.1908), cranial excursion 9.1 ± 3.4 cm.
  // Tuned for scene legibility: 7 cm amplitude / 0.63 m neck lever = 0.111 rad.
  // The read 9.1 cm is peak-to-peak, not amplitude; this is deliberately larger.
  const nod = 0.111 * Math.min(1, speed / 0.8) * Math.sin(4 * Math.PI * (legs.legs[0].phase - 0.15));
  // Turn away from a nearby person's head, eased from the previous carriage.
  const muzzle = f.prev.point(HEAD, new Vector3(0, -0.42, 0.33), new Vector3());
  const distance = person ? muzzle.distanceTo(person) : Infinity;
  const local = person ? new Vector3().copy(person).sub(f.prev.position(0)).applyQuaternion(f.prev.rotation(0).clone().invert()) : new Vector3();
  const away = -Math.sign(local.x) * 0.5 * Math.max(0, Math.min(1, (0.8 - distance) / 0.3));
  const previous = new Vector3(0, 0, 1).applyQuaternion(f.prev.local(NECK));
  const turn = Math.atan2(previous.x, previous.z) + (away - Math.atan2(previous.x, previous.z)) * (1 - Math.exp(-4 * f.dt));
  f.current.setLocal(NECK, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), nod)));
  f.current.setLocal(HEAD, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -nod / 2));
}
