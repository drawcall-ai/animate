import { action } from '@pmndrs/timeline';
import { live, type Behaviour, type Live, type Target } from '../core/goal';
import type { ReadonlyPose } from '../core/pose';
// Recalled: Back et al. (1995), Hodson (2000/2001), Clayton (2004) curves as retained by the spike.
import { Euler, Quaternion, Vector3 } from 'three';
import type { Frame } from '../core/body';
import { Legs } from '../core/legs/legs';
import type { JointCycle } from '../core/legs/cycle';
import type { LegChain } from '../core/legs/legs';
import { LEGS, PELVIS, NECK, HEAD, MUZZLE } from './skeleton';
import { powerGait } from '../core/legs/schedule';

// Recalled: hip height ~1.2 m, slow walk threshold 0.8 m/s (spike).
// Recalled: Hildebrand lateral walk sequence and Clayton/Hobbs diagonal trot offsets.
// Recalled: Alexander/Jayes stride coefficients; Hodson stance at 1.6 / 3.7 m/s.
// Tuned: 5 cm walk clearance for the proxy hoof; trot retains the recalled spike margins.
const walk = powerGait(1.2, 0.8, [0.25, 0.75, 0, 0.5], 2.3, 0.68 * Math.pow(1.6, 0.7), [0.05, 0.05, 0.05, 0.05]);
export const HORSE_WALK = {
  ...walk, referenceSpeed: 1.6, referenceBlend: 1,
  // Tuned from the read 28% fore-cannon crossing, allowing for the coffin's forward offset.
  contacts: walk.contacts.map((contact, i) => ({
    ...contact,
    // Tuned: hinds release earlier, before the planted hoof draws the hip into excessive retraction.
    duty: i < 2 ? contact.duty : (v: number, fr: number) => 0.9 * contact.duty(v, fr),
    stanceCenter: i < 2 ? 0.31 : undefined,
  })),
};
export const HORSE_TROT = powerGait(1.2, 0.8, [0.52, 0.02, 0, 0.5], 2.15, 0.3 * Math.pow(3.7, 0.7), [0.035, 0.035, 0, 0]);

// Read: Back et al. 1995 fore/hind abstracts describe TROT at 4 m/s, not walk.
// Recalled: Back et al. 1996 comparison: walk stance has less shoulder/stifle/hock flexion.
// Read: Hodson et al. 2001 abstract (doi:10.2746/042516401776767485): loading
// flexion in the first 10%, stifle flexion after 28%, coordinated stifle/hock swing.
// Recalled: trot curves below and the 1996 excursion values retained from the spike.
// Read: Hodson et al. 2000 (doi:10.2746/042516400777032237): fore cannon vertical at 28% stride.
// Tuned: walk keys implement those findings; they are not digitised paper data.
const cycle = (keys: [number, number][], alternate?: [number, number][], alternateWeight = 1): JointCycle => ({ duty: 0.45, keys, alternate, alternateWeight });
// Tuned walk elbow swing scale: clear the sole before the floor forces a pastern correction.
const WALK_ELBOW_SCALE = 75.2 / 84.7;
const FORE = {
  scapula: cycle([[0, 8], [0.22, 0], [0.45, -10], [0.7, 2], [0.9, 10]]),
  shoulder: cycle([[0, 5], [0.22, -3], [0.45, -15], [0.6, -5], [0.75, 15], [0.9, 15]]),
  elbow: cycle([[0, -5], [0.22, -12], [0.45, -5], [0.58, 35], [0.7, 55], [0.85, 20], [0.95, 0]],
    [[0, -5], [0.22, -12], [0.45, -5], [0.58, 38 * WALK_ELBOW_SCALE], [0.7, 55 * WALK_ELBOW_SCALE], [0.85, 20 * WALK_ELBOW_SCALE], [0.95, 0]]),
  carpus: cycle([[0, 0], [0.4, 0], [0.5, -30], [0.62, -87.9], [0.75, -50], [0.88, -5]],
    [[0, 0], [0.4, 0], [0.5, -30 * 66 / 87.9], [0.62, -66], [0.75, -50 * 66 / 87.9], [0.88, -5 * 66 / 87.9]]),
};
// Read: Hodson 2001: maximal protraction shortly before swing ends; the stifle
// starts flexing after 28% stride. The walk alternate begins folding before toe-off.
// Hock target 43° approximates the read 42.4° walk ROM (125.2–167.6°), reproduced
// in Mendez-Angulo, Effect of Water Level on Kinematics of Healthy Horses, Table 1.
// Read: Egenvall et al. 2023, doi:10.7717/peerj.16373: circle-walk hip ROM 16.8–20.7°.
// Tuned: smaller hip references and a stronger hip preference distribute contact corrections
// into the distal joints. Hock keys counter that redistribution during support; they are not
// measured joint angles. These are soft references: report solved excursions, not target values.
// Tuned walk hip stiffness: keep the solved excursion near the recalled 17–21° band during pursuit.
const WALK_HIP_WEIGHT = 16;
const HIND = {
  hip: cycle([[0, 10], [0.22, 0], [0.45, -12], [0.6, -3], [0.78, 15], [0.92, 14]],
    [[0, 12], [0.22, 5], [0.45, -5], [0.6, -1], [0.78, 3], [0.92, 9]], WALK_HIP_WEIGHT),
  stifle: cycle([[0, -5], [0.15, -12], [0.45, 0], [0.58, -30], [0.7, -45], [0.85, -20], [0.95, -5]],
    [[0, 0], [0.07, -3], [0.22, 0], [0.45, -12], [0.58, -30], [0.7, -43], [0.85, -20], [0.95, 0]]),
  // Tuned 35° mid-support walk keys offset distal redistribution; not measured angles.
  hock: cycle([[0, 5], [0.15, 15], [0.45, 0], [0.58, 30], [0.7, 45], [0.85, 20], [0.95, 5]],
    [[0, -12], [0.07, -12], [0.14, -20], [0.22, 35], [0.45, 35], [0.58, 30], [0.7, 43], [0.85, 20], [0.95, -12]]),
};
// Tuned walk: spring under load, then a modest pastern fold. The trot's large
// fetlock fold was turning the whole free hoof under, rather than clearing it.
const FORE_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, -30 * 35 / 55], [0.68, -35], [0.82, -20 * 35 / 55], [0.95, 0]]);
const FORE_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 8], [0.8, 4]]);
// Tuned 0° free-swing hind fetlock keys: the walk’s hind pastern relaxes after support; stifle and hock flexion clear the free hoof.
const HIND_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, 0], [0.68, 0], [0.82, 0], [0.95, 0]]);
const HIND_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 35], [0.8, 15]]);
/** the hoof flat on the ground, breaking over its toe at the end of the stance (°, + toe up) */
// Tuned: finish the toe roll before lift-off, braking the downward spin inherited by swing.
const BREAKOVER: LegChain['rocker'] = [[0, 0], [0.75, 0], [0.9, -25], [1, -25]];

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

/** Pelvic walk motion, written before the leg solve so planted hooves stay fixed.
 * Read: Egenvall et al. 2023, doi:10.1007/s11259-023-10132-y: circle walk
 * roll ROM ~10°, yaw ~9°, pitch ~7°. Use conservative straight/slow-walk
 * excursions of 6°, 5°, 4°; one roll/yaw cycle and two pitch cycles per stride.
 * This rig has one pelvis joint, not separate thoracolumbar vertebrae.
 */
export function horsePelvis(f: Frame, legs: Legs): void {
  const moving = walkBlend(f);
  const phase = 2 * Math.PI * legs.legs[2].phase;
  const wave = Math.sin(phase);
  f.current.setLocal(PELVIS, new Quaternion().setFromEuler(new Euler(
    2 * Math.PI / 180 * Math.sin(2 * phase) * moving,
    2.5 * Math.PI / 180 * wave * moving,
    3 * Math.PI / 180 * wave * moving, 'YXZ',
  )));
}

/** Walk head carriage: two nods per stride, entrained to foreleg contact rather than wall time. */
export function horseCarriage(f: Frame, legs: Legs, avoid?: Readonly<Vector3>): void {
  const moving = walkBlend(f);
  // Read: Loscher et al. 2016 (doi:10.1098/rspb.2016.1908), cranial excursion 9.1 ± 3.4 cm.
  // Tuned for scene legibility: 7 cm amplitude / 0.63 m neck lever = 0.111 rad.
  // The read 9.1 cm is peak-to-peak, not amplitude; this is deliberately larger.
  // Tuned phase: peak nod between fore contacts rather than at hoof strike.
  const nod = 0.111 * moving * Math.sin(4 * Math.PI * (legs.legs[0].phase - 0.15));
  // Tuned clearance: turn up to 0.5 rad within 0.8 m, over a 0.3 m band,
  // with a 0.25 s response. The caller supplies the point to avoid.
  const muzzle = f.prev.point(HEAD, MUZZLE, new Vector3());
  const distance = avoid ? muzzle.distanceTo(avoid) : Infinity;
  const local = avoid ? new Vector3().copy(avoid).sub(f.prev.position(0)).applyQuaternion(f.prev.rotation(0).clone().invert()) : new Vector3();
  const away = -Math.sign(local.x) * 0.5 * Math.max(0, Math.min(1, (0.8 - distance) / 0.3));
  const previous = new Vector3(0, 0, 1).applyQuaternion(f.prev.local(NECK));
  const turn = Math.atan2(previous.x, previous.z) + (away - Math.atan2(previous.x, previous.z)) * (1 - Math.exp(-4 * f.dt));
  f.current.setLocal(NECK, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), nod)));
  f.current.setLocal(HEAD, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -nod / 2));
}

const walkBlend = (f: Frame) => Math.min(1, f.prev.position(0).distanceTo(f.prev2.position(0)) / (f.dt * HORSE_WALK.slowest));

// Tuned walking acceleration (m/s²); catch-up speed follows v² = u² + 2ad, capped at the gait’s reference walk.
const FOLLOW_ACCEL = 0.65;

/** Follow a floor goal with the horse's pelvis, legs and head working together. */
export function horseFollow<W>(start: ReadonlyPose, goal: Live<Pick<Target, 'position' | 'velocity'>, W>, options: { avoid?: Live<Readonly<Vector3> | undefined, W> } = {}): Behaviour<W> {
  return function* () {
    const legs = new Legs(start, horseLegs(), HORSE_WALK);
    yield* action<Frame<W>>({ update: (f) => {
      horsePelvis(f, legs);
      const target = live(goal, f);
      const pace = Math.max(HORSE_WALK.slowest, target.velocity?.length() ?? 0);
      const gap = target.position.clone().sub(f.prev.position(0)).setY(0).length();
      const speed = Math.min(HORSE_WALK.referenceSpeed, Math.sqrt(pace ** 2 + 2 * FOLLOW_ACCEL * gap));
      legs.toward(f, target, { speed, accel: FOLLOW_ACCEL });
      horseCarriage(f, legs, options.avoid && live(options.avoid, f));
    } });
  };
}
