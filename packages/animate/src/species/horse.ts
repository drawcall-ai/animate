// The horse: a ~500 kg warmblood of 1.60 m at the withers (16 hands), standing square at rest: +Y up, facing +Z, its left +X; the root
// (the trunk) on the spine under the saddle. Recalled: all dimensions, masses and ROM below are approximate warmblood data; sources
// accompany each block.
import { Euler, Quaternion, Vector3 } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import type { Frame } from '../kernel/frame';
import type { ReadonlyPose } from '../kernel/pose';
import { clamp, minimumJerk, yawOf } from '../kernel/math';
import { seedOf } from '../kernel/random';
import { swing } from '../kernel/life';
import type { Gait } from './gait';
import { carriage, type CarriedBones, type Striding } from './carriage';
import type { JointCycle } from './cycle';
import type { LegChain } from './leg';
import { powerGait, stanceOf } from './schedule';
import { gaitAt } from './scaled';
import { build, needing, type Attention, type BoneNames, type Having, type LegRole, type Range, type Species, type Vec3 } from './define';

/** the bones a horse's skeleton names (each leg's, `left`/`right` before each) */
export type HorseBone =
  | 'trunk' | 'back' | 'pelvis' | 'neck' | 'head' | 'tail' | 'leftEar' | 'rightEar'
  | `${'left' | 'right'}${'Scapula' | 'Humerus' | 'Forearm' | 'ForeCannon' | 'ForePastern' | 'ForeHoof' | 'Femur' | 'Gaskin' | 'HindCannon' | 'HindPastern' | 'HindHoof'}`;

/**
 * A horse of a skeleton (as rigged with @drawcall/rig, `as const`), its bones named as `HorseBone`: its walk (or `'trot'`), its posture
 * over its legs as it heeds what it looks at, a tether and a startle. Its numbers are a warmblood's of 1.4 m to the trunk, made
 * dynamically similar to the skeleton's size.
 */
export function horse<const S extends readonly SkeletonBone[]>(skeleton: S & Having<S, HorseBone>, gait: 'walk' | 'trot' = 'walk'): Species<BoneNames<S>, never> {
  needing(skeleton, HORSE_BONES, 'horse');
  const at = (name: string) => {
    const bone = skeleton.find((b) => b.name === name);
    if (!bone) throw new Error(`horse: the skeleton has no ${name}`);
    return new Vector3(...bone.position);
  };
  // (its size against the warmblood its numbers are for: the trunk's height)
  const size = at('trunk').y / TRUNK;
  const sized = (offset: Vector3): Vec3 => offset.clone().multiplyScalar(size).toArray();
  const masses: Record<string, number> = { trunk: MASS.trunk, pelvis: MASS.pelvis, neck: MASS.neck, head: MASS.head };
  const centres: Record<string, Vec3 | readonly [string, number]> = {
    trunk: sized(CENTRE.trunk), pelvis: sized(CENTRE.pelvis), neck: ['head', 0.45], head: sized(CENTRE.head),
  };
  const legs: LegRole<string>[] = [];
  for (const [fore, end] of [[true, 'Fore'], [false, 'Hind']] as const) {
    for (const side of ['left', 'right'] as const) {
      const name = (bone: string) => `${side}${bone}`;
      const [upper, middle, cannon] = fore ? [name('Humerus'), name('Forearm'), name('ForeCannon')] : [name('Femur'), name('Gaskin'), name('HindCannon')];
      const pastern = name(`${end}Pastern`), hoof = name(`${end}Hoof`);
      if (fore) Object.assign(masses, { [name('Scapula')]: MASS.scapula, [upper]: MASS.humerus, [middle]: MASS.forearm, [cannon]: MASS.foreCannon });
      else Object.assign(masses, { [upper]: MASS.femur, [middle]: MASS.gaskin, [cannon]: MASS.hindCannon });
      Object.assign(masses, { [pastern]: MASS.pastern, [hoof]: MASS.hoof });
      // (the sole on the floor under the coffin joint, a little behind it: the hoof's middle, where it stands)
      const sole = new Vector3(0, -at(hoof).y, (fore ? SOLE.fore : SOLE.hind) * size);
      Object.assign(centres, {
        ...(fore ? { [name('Scapula')]: [upper, 0.5] } : {}),
        [upper]: [middle, 0.45], [middle]: [cannon, 0.4], [cannon]: [pastern, 0.45], [pastern]: [hoof, 0.5],
        [hoof]: sole.clone().multiplyScalar(0.5).toArray(),
      });
      legs.push({
        joints: [
          ...(fore ? [{ bone: name('Scapula'), axes: 'x', cycle: FORE.scapula }] : []),
          { bone: upper, axes: 'yzx', cycle: fore ? FORE.shoulder : HIND.hip },
          { bone: middle, axes: 'x', cycle: fore ? FORE.elbow : HIND.stifle },
          { bone: cannon, axes: 'x', cycle: fore ? FORE.carpus : HIND.hock },
          { bone: pastern, axes: 'zx', cycle: fore ? FORE_FETLOCK : HIND_FETLOCK },
          { bone: hoof, axes: 'x', cycle: fore ? FORE_COFFIN : HIND_COFFIN },
        ],
        heel: sole.clone().add(HEEL.clone().multiplyScalar(size)).toArray(),
        toe: sole.clone().add(TOE.clone().multiplyScalar(size)).toArray(),
        rocker: BREAKOVER,
      });
    }
  }
  const names = skeleton.map((bone) => bone.name);
  const limits: Record<string, Range> = {};
  for (const name of names) {
    const range = RANGES[name] ?? RANGES[name.replace(/^(left|right)/, '')];
    if (!range || name === 'trunk') continue;
    // (the right side's sideways swing and twist mirror the left's)
    const right = name.startsWith('right'), mirror = ([lo, hi]: [number, number]): [number, number] => [-hi, -lo];
    limits[name] = { ...range, swing: [right ? mirror(range.swing[0]) : range.swing[0], range.swing[1]], twist: right ? mirror(range.twist) : range.twist };
  }
  // Tuned diagnostics only: a whole ROM traversed in 30 ms is a gross discontinuity. This follows the humanoid snap heuristic; it never
  // limits the solver's rates.
  const snaps = Object.fromEntries(Object.entries<Range>(limits).map(([name, limit]) => {
    const speed = Math.max(...[...limit.swing, limit.twist].map(([lo, hi]) => hi - lo)) / DEG / 0.03;
    return [name, { speed, accel: speed / 0.03 }];
  }));
  const reference = gait === 'trot' ? HORSE_TROT : HORSE_WALK;
  const made = build<never>(skeleton, {
    root: 'trunk',
    legs,
    gaze: { eyes: { bone: 'head', at: EYES.clone().multiplyScalar(size).toArray() }, range: EYE_RANGE },
    carriage: HORSE_CARRIAGE,
  }, {
    gait: gaitAt(reference, size),
    masses: Object.fromEntries(Object.entries(masses).map(([name, mass]) => [name, mass * size ** 3])),
    centres,
    limits,
    snaps,
    // (its trunk's lean as quick as its stride: ∝ 1/√length)
    inertia: { ...INERTIA, frequency: INERTIA.frequency / Math.sqrt(size) },
  });
  const { skeleton: built } = made;
  const bones = { head: built.index('head'), neck: built.index('neck'), ears: [built.index('leftEar'), built.index('rightEar')] };
  const halter = HALTER.clone().multiplyScalar(size);
  const chains = made.legs?.chains ?? [];
  return { ...made, bones: skeleton, scale: size, legs: made.legs && { ...made.legs, posture: (start, gait, seed) => horseMotion(start, gait, chains, bones, halter, seed) } };
}

/** every bone a horse's skeleton names */
const HORSE_BONES: readonly HorseBone[] = ['trunk', 'back', 'pelvis', 'neck', 'head', 'tail', 'leftEar', 'rightEar',
  ...(['left', 'right'] as const).flatMap((side) => (['Scapula', 'Humerus', 'Forearm', 'ForeCannon', 'ForePastern', 'ForeHoof', 'Femur', 'Gaskin', 'HindCannon', 'HindPastern', 'HindHoof'] as const)
    .map((part) => `${side}${part}` as const))];

/** the trunk's height of the warmblood the horse's numbers are for (m) */
const TRUNK = 1.4;
const DEG = Math.PI / 180;

/**
 * Each segment's mass (kg) for 500 kg, shares of the order Buchner et al. 1997 measured in Dutch
 * Warmblood horses (J Biomech 30:653): head ~4.5%, neck ~6.5%, a foreleg ~6.5% (most of it the
 * scapula and upper arm), a hind leg ~7.5% (most of it the thigh), the rest the trunk. Its centre
 * of mass sits ahead of the middle: the forelegs bear ~57% of the weight standing (Merkens et al.
 * 1993; checked in the tests).
 */
const MASS = { trunk: 213, pelvis: 90, neck: 32, head: 22, scapula: 9, humerus: 12, forearm: 7, foreCannon: 2, femur: 24, gaskin: 9, hindCannon: 2.5, pastern: 1.3, hoof: 1.2 };
/**
 * where the trunk's, pelvis's and head's masses centre from their joints (m): the warmblood's points less its joints — the trunk's below
 * and ahead of the root, the pelvis's below and behind its joint, the head's 0.4 of the way from the poll to the muzzle
 */
const CENTRE = {
  trunk: new Vector3(0, 1.12, 0.3).sub(new Vector3(0, 1.4, 0)),
  pelvis: new Vector3(0, 1.27, -0.68).sub(new Vector3(0, 1.39, -0.57)),
  head: new Vector3(0, 1.38, 1.5).sub(new Vector3(0, 1.75, 1.2)).multiplyScalar(0.4),
};
/** how far behind the coffin joint the sole's middle stands (m): the warmblood's, fore and hind */
const SOLE = { fore: 0.7 - 0.73, hind: -0.64 - -0.624 };
/** the toe ahead of the sole's middle and the heel behind it (m): a shod hoof ~14 cm long */
const TOE = new Vector3(0, 0, 0.075);
const HEEL = new Vector3(0, 0, -0.065);
/** Derived: between the eyes, about a third of the way from the poll to the muzzle (m, head bone) */
const EYES = new Vector3(0, -0.12, 0.1);
/** Tuned (rad): the eyes add little to where the head turns (the posture turns it) */
const EYE_RANGE = { down: 0.2, up: 0.2, side: 0.3 };
/** where a halter's lead ring is (m, head bone) */
const HALTER = new Vector3(0, -0.3, 0.05);

/** a range in degrees: twist about y (the bone's length), swing about z (sideways) and x (fore and aft, + turning a hanging bone's end back) */
const range = (z: [number, number], x: [number, number], twist: [number, number]): Range => ({
  axis: 1,
  swing: [[z[0] * DEG, z[1] * DEG], [x[0] * DEG, x[1] * DEG]],
  twist: [twist[0] * DEG, twist[1] * DEG],
});

/**
 * Each joint's range of motion off standing square (°; the left side's, the right mirrors it
 * sideways). Sagittal ranges from equine kinematics at walk, trot and canter and from passive
 * flexion (Back et al. 1995, Equine Vet J 27:31 and 27:39; Clayton, The Dynamic Horse 2004;
 * Denoix, Biomechanics and Physical Training of the Horse 2014): the scapula rocks ~±15° on the
 * thorax, to ~±19° cantering (its excursion to ~38°: Back et al. 1997); the shoulder ±45°; the elbow flexes ~90° (the forearm forward) and opens ~25° past
 * standing (recalled: late in a trot's stance it extends to ~150–160°, ~17–27° over its ~133°
 * standing, Back et al. 1995; at ~15° the legs fell short of their hooves late in stance); the carpus folds ~110° in a high swing and hardly extends past straight; the fetlock
 * sinks ~45° under load and folds ~100° in the swing; the coffin joint a little either way.
 * Behind, the hip flexes ~55° and extends ~40°; the stifle and hock flex ~75° and ~85° together
 * (the reciprocal apparatus), and open past standing to ~155° and ~170°, ~40° and ~28°. The lumbosacral joint flexes and extends
 * ~±15°; the neck reaches the head to the ground and up, turns and bends; the poll nods and turns.
 * Sideways and in twist every leg joint is all but a hinge, the fetlock and coffin joints with
 * ~±10° of play each (the hoof stays flat as the leg leans over it: on a circle the limb leans in
 * ~10°; the coffin joint's lateromedial rotation and twist of up to ~10°: Chateau, Degueurce &
 * Denoix 2004, recalled).
 */
const RANGES: Record<string, Range> = {
  Ear: range([-45, 45], [-60, 60], [-120, 120]),
  tail: range([-60, 60], [-60, 60], [-70, 70]),
  back: range([-8, 8], [-15, 15], [-10, 10]),
  pelvis: range([-8, 8], [-15, 15], [-10, 10]),
  neck: range([-20, 20], [-40, 60], [-35, 35]),
  head: range([-20, 20], [-40, 45], [-30, 30]),
  Scapula: range([-6, 6], [-19, 19], [-6, 6]),
  Humerus: range([-12, 12], [-45, 45], [-10, 10]),
  Forearm: range([-3, 3], [-90, 25], [-3, 3]),
  ForeCannon: range([-3, 3], [-8, 110], [-3, 3]),
  Femur: range([-15, 15], [-55, 40], [-10, 10]),
  Gaskin: range([-4, 4], [-40, 75], [-4, 4]),
  HindCannon: range([-4, 4], [-85, 28], [-4, 4]),
  ForePastern: range([-10, 10], [-45, 100], [-10, 10]),
  HindPastern: range([-10, 10], [-45, 100], [-10, 10]),
  ForeHoof: range([-10, 10], [-25, 35], [-10, 10]),
  HindHoof: range([-10, 10], [-25, 35], [-10, 10]),
};

/**
 * How the horse's trunk takes its acceleration: pitched as a dog's but less (read: Walter & Carrier 2009 for a dog setting off, 0.3–0.5
 * of atan(a / g); no horse's measure found; tuned: below that, its forelegs straight in stance taking no more of its withers let down);
 * rolled into a bend ~1° short of atan(v² / r g) (read via summary: Brocklehurst et al. 2014: 12.0° at 13.1°, 19.0° at 19.8°); its
 * response a person's (0.8 Hz at 0.9 m hips) made dynamically similar on its 1.2 m legs: × √(0.9 / 1.2)
 */
const INERTIA = { ahead: 0.25, back: 0.2, roll: 0.9, most: 0.3, frequency: 0.7, damping: 0.65 };

// Recalled: 1.2 m hip, .8 m/s slow walk; Hildebrand walk/Clayton-Hobbs trot offsets;
// Alexander/Jayes stride coefficients, Hodson stance at 1.6/3.7 m/s.
// Derived: 5 cm proxy-hoof clearance in both gaits keeps the early sole-height peak above the passive fold.
const walk = powerGait({ height: 1.2, slowest: 0.8, offsets: [0.25, 0.75, 0, 0.5], stride: 2.3, stance: stanceOf(0.68, 1.6, 1.2), clearance: [0.05, 0.05, 0.05, 0.05] });
/** a warmblood's walk */
export const HORSE_WALK: Gait = {
  ...walk, referenceSpeed: 1.6, referenceBlend: 1,
  // Dunbar ranges read via summary; landmark/hip phase derived after solving. Derived: the croup's rise × 1.1 since the pelvis
  // moved 9 cm back: the trunk pitching ~6° over a back that much longer (read: Dunbar et al. 2008, withers 7 ± 1 cm, head 12–15 cm, its
  // pitch ~9°; Faber et al. 2000, the back flexing ~7° twice a stride at 1.6 m/s — the test's bounds).
  body: { withers: 0.035, croup: [0.055, 1.52], spine: 2.5, spinePhase: 0.3, roll: 4, yaw: 2.5, headPitch: 4.5, headRise: 0.0675, headWithers: 0 },
  // Tuned from the read 28% fore-cannon crossing, allowing for the coffin's forward offset.
  contacts: walk.contacts.map((contact, i) => ({
    ...contact,
    // Tuned: hinds release earlier, before the planted hoof draws the hip into excessive retraction.
    duty: i < 2 ? contact.duty : (v: number, fr: number) => 0.9 * contact.duty(v, fr),
  })),
};
/** a warmblood's trot */
const HORSE_TROT: Gait = {
  ...powerGait({ height: 1.2, slowest: 0.8, offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: stanceOf(0.3, 3.7, 1.2), clearance: [0.05, 0.05, 0.05, 0.05] }),
  // Read via summary: Dunbar's 1° trunk ROM is the low end of 2±1°; read or read via summary: back 4–6°, roll 9.5°. Derived: the croup with the withers
  // but for 0.5° of trunk pitch over the 1.14 m between withers and croup.
  body: { withers: -0.045, croup: [-0.035, 0], spine: 3, spinePhase: 0, roll: 4.75, yaw: 2.5, headPitch: 2.5, headRise: 0, headWithers: 1 },
};

// Read: Back et al. 1995 fore/hind abstracts describe TROT at 4 m/s, not walk.
// Recalled: Back et al. 1996 comparison: walk stance has less shoulder/stifle/hock flexion.
// Read: Hodson 2001 abstract (doi:10.2746/042516401776767485): loading flexion <10%, stifle >28%, stifle/hock coupled.
// Recalled: the trot curves below and the 1996 excursion values.
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
// Read: Hodson 2001 (above): maximal protraction before contact; walk folds before toe-off.
// Read via Mendez-Angulo, Effect of Water Level, Table 1: hock walk 125.2–167.6°; 43° target approximates 42.4° ROM.
// Read: Egenvall et al. 2023, doi:10.7717/peerj.16373: circle-walk hip ROM 16.8–20.7°.
// Tuned soft references: smaller hip curves/stronger preference shift contact correction distally;
// hock keys counter it in support. Report solved excursions (hip ~17–21°), not these targets.
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
// Tuned walk: spring under load, then modest pastern fold; trot folds turned the free hoof under.
const FORE_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, -30 * 35 / 55], [0.68, -35], [0.82, -20 * 35 / 55], [0.95, 0]]);
const FORE_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 8], [0.8, 4]]);
// Tuned 0° free-swing hind fetlock keys: the walk’s hind pastern relaxes after support; stifle and hock flexion clear the free hoof.
const HIND_FETLOCK = cycle([[0, 5], [0.22, 30], [0.45, 0], [0.55, -30], [0.68, -55], [0.82, -20], [0.95, 0]],
  [[0, 5], [0.22, 30], [0.45, 0], [0.55, 0], [0.68, 0], [0.82, 0], [0.95, 0]]);
const HIND_COFFIN = cycle([[0, 0], [0.22, -5], [0.45, 10], [0.6, -15], [0.8, -5]],
  [[0, 0], [0.22, -5], [0.45, 10], [0.6, 35], [0.8, 15]]);
// Tuned hoof stance pitch (°, +toe up): finish breakover before lift-off to brake downward spin.
const BREAKOVER: LegChain['rocker'] = [[0, 0], [0.75, 0], [0.9, -25], [1, -25]];

/**
 * What the horse's gait carries, and its quiet life (recalled): ears flick every 2–6 s, the tail swishes every 5–20 s, the head turns every
 * 10–30 s and the weight shifts every 20–60 s (tuned: the first at 2–6 s); each goal crosses neutral so every change shows (derived).
 */
const HORSE_CARRIAGE: CarriedBones = { spine: 'back', pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.7, period: 1.2, cycles: 1 }, life: [
  ['leftEar', { every: [2, 6], rate: 8, pick: swing }], ['rightEar', { every: [2, 6], rate: 8, pick: swing }],
  ['tail', { every: [5, 20], rate: 1, pick: swing }], ['head', { every: [10, 30], rate: 1, pick: swing }],
  ['weight', { every: [20, 60], first: [2, 6], rate: 1, pick: swing }],
] };

const turn = (x = 0, y = 0, z = 0, out = _q) => out.setFromEuler(_e.set(x, y, z, 'YXZ'));

/** Posture before contact solving: contact phase read via summary, idle/tail timing recalled.
 * Gait ranges keep the provenance given with them above, not fresh paper readings. */
function horseMotion(start: ReadonlyPose, gait: Gait, legs: readonly LegChain[], bones: { head: number; neck: number; ears: number[] }, halter: Vector3,
  seed = seedOf(start.position(0).x, start.position(0).z)) {
  const carried = carriage(start, legs, HORSE_CARRIAGE, gait, seed), idle = carried.life, rand = idle.rand;
  const { head: headBone, neck: neckBone, ears } = bones;
  const rest = { quiet: 0, value: 0, side: 0, at: 60 + 120 * rand(), pitches: [0, 0, 0, 0] };
  const reaction = new Vector3(), tied = { position: new Vector3(), length: 0 };
  let responseTime = Infinity, startled: Readonly<Vector3> | undefined;
  /** a saddle/girth event at a world point: the horse turns to it and settles over about four seconds */
  const react = (point: Readonly<Vector3>): void => { reaction.copy(point); responseTime = 0; };
  return {
    react,
    prepare(f: Frame, striding: Striding, attention: Attention = {}, look: Readonly<Vector3> | null = null): void {
      // (a new startle point is a new event)
      const startle = attention.startle?.(f.time);
      if (startle && startle !== startled) react(startled = startle);
      if (tied.length) {
        const stretch = f.prev.point(headBone, halter, _point).distanceTo(tied.position);
        if (stretch > tied.length + 1e-4) f.dev?.append(f.time - f.dt, { check: 'horse tether (m)', value: stretch, limit: tied.length, where: 'halter' });
      }
      carried.step(f, striding);
      const m = carried.moving;
      rest.quiet = carried.speed < 0.01 ? rest.quiet + f.dt : 0;
      if (rest.quiet >= rest.at) { rest.side = rest.side ? -rest.side : (rand() < 0.5 ? 1 : -1); rest.at = rest.quiet + 60 + 240 * rand(); }
      rest.value += ((rest.quiet >= 60 ? rest.side : 0) * (1 - m) - rest.value) * (1 - Math.exp(-f.dt));
      rest.pitches[2] = -25 * Math.max(0, rest.value); rest.pitches[3] = 25 * Math.min(0, rest.value);
      striding.rest(rest.pitches);
      responseTime += f.dt;
      const response = minimumJerk(responseTime / 0.25) * (1 - minimumJerk((responseTime - 1) / 3));
      const inverse = turn(0, -yawOf(f.prev.rotation(0)), 0, _inverse);
      if (look) _look.copy(look).sub(f.prev.position(0)).applyQuaternion(inverse);
      _reaction.copy(reaction).sub(f.prev.position(0)).applyQuaternion(inverse);
      const attended = look && look.distanceTo(f.prev.position(headBone)) < 5 ? clamp(Math.atan2(_look.x, _look.z), -0.55, 0.55) : 0;
      const toward = Math.sign(_reaction.x);
      const distance = look ? look.distanceTo(f.prev.position(headBone)) : Infinity;
      // Tuned avoidance: 0.8 m / 0.3 m transition, 0.5 rad, 0.25 s response.
      const away = look ? -Math.sign(_look.x) * 0.5 * Math.max(0, Math.min(1, (0.8 - distance) / 0.3)) : 0;
      // Tuned gains (rad): neck .35/head .2 sum to 31.5° look-back (derived); ears −.3, pelvis .025, tail .2.
      // Derived: hip-axis roll within the skeleton's range shifts the croup up to 2.5 cm; rests take over.
      carried.write(f, {
        lift: -0.04 * Math.abs(rest.value), weight: 1 - Math.abs(rest.value),
        pelvisRoll: (-0.12 * rest.value + 0.025 * toward * response) * (1 - m),
        neckYaw: away || (0.3 * attended * (1 - m) + 0.18 * idle.value('head') * (1 - m) + 0.35 * toward * response),
        headYaw: 0.2 * toward * response, tail: 0.2 * response,
      });
      ears.forEach((ear, i) => {
        const swivel = clamp(attended + idle.value(i === 0 ? 'leftEar' : 'rightEar') * 0.7 + toward * response, -2, 2);
        f.current.setLocal(ear, turn(-0.3 * response, swivel), 1 - Math.exp(-10 * f.dt));
      });
      const tether = attention.tether?.(f.time);
      tied.length = tether?.length ?? 0;
      if (tether) {
        if (!(tether.length > 0 && Number.isFinite(tether.length)) || !tether.position.toArray().every(Number.isFinite)) throw new Error('horse tether needs a finite point and positive length');
        tied.position.copy(tether.position);
        const neck = _neck.copy(f.current.local(neckBone)), head = _head.copy(f.current.local(headBone));
        const knot = _point.copy(tether.position).sub(f.current.position(neckBone)).applyQuaternion(inverse);
        const base = turn(0, clamp(Math.atan2(knot.x, knot.z), -0.55, 0.55), 0, _base);
        f.current.setLocal(neckBone, base); f.current.setLocal(headBone, _q.identity());
        if (f.current.point(headBone, halter, _point).distanceTo(tether.position) > tether.length) throw new Error('horse tether outside neck reach');
        let lo = 0, hi = 1;
        for (let i = 0; i < 12; i++) {
          const u = (lo + hi) / 2;
          f.current.setLocal(neckBone, _q.copy(base).slerp(neck, u)); f.current.setLocal(headBone, _q.identity().slerp(head, u));
          if (f.current.point(headBone, halter, _point).distanceTo(tether.position) <= tether.length) lo = u; else hi = u;
        }
        f.current.setLocal(neckBone, _q.copy(base).slerp(neck, lo)); f.current.setLocal(headBone, _q.identity().slerp(head, lo));
      }
    }
  };
}

const _q = new Quaternion(), _inverse = new Quaternion(), _neck = new Quaternion(), _head = new Quaternion(), _base = new Quaternion();
const _e = new Euler(), _point = new Vector3(), _look = new Vector3(), _reaction = new Vector3();
