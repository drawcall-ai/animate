// Recalled: all dimensions, masses and ROM below are the spike's approximate warmblood data; sources accompany each block. No new measurements.
// The horse: a ~500 kg warmblood of 1.60 m at the withers (16 hands), standing square at rest:
// +Y up, facing +Z, its left +X; the root (the trunk) on the spine under the saddle.
import { Vector3 } from 'three';
import { Skeleton, type BoneDef, type Limit } from '../core/skeleton';

/** a leg, as the legs are listed everywhere: [leftFore, rightFore, leftHind, rightHind] */
export type LegName = 'leftFore' | 'rightFore' | 'leftHind' | 'rightHind';
export const LEG_NAMES: readonly LegName[] = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];

/**
 * A leg's bones: its chain (named as the leg) of two segments from the shoulder or hip down to the
 * carpus or hock, the scapula above a foreleg's, and the cannon, pastern and hoof below.
 */
export interface HorseLeg {
  name: LegName;
  fore: boolean;
  /** +1 left, −1 right */
  side: 1 | -1;
  /** a foreleg's scapula (it turns on the thorax about its top), null behind */
  scapula: number | null;
  /** the humerus or femur, the forearm or gaskin: the chain's two segments */
  upper: number;
  middle: number;
  /** the chain's tip: its origin is the carpus or hock */
  cannon: number;
  /** its origin is the fetlock */
  pastern: number;
  /** its origin is the coffin joint */
  hoof: number;
  /** the sole's middle, where the hoof stands, its toe, where it breaks over, and its heel (in the hoof's frame) */
  sole: Vector3;
  toe: Vector3;
  heel: Vector3;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/**
 * Each segment's mass (kg) for 500 kg, shares of the order Buchner et al. 1997 measured in Dutch
 * Warmblood horses (J Biomech 30:653): head ~4.5%, neck ~6.5%, a foreleg ~6.5% (most of it the
 * scapula and upper arm), a hind leg ~7.5% (most of it the thigh), the rest the trunk. Its centre
 * of mass sits ahead of the middle: the forelegs bear ~57% of the weight standing (Merkens et al.
 * 1993; checked in the tests).
 */
const MASS = {
  trunk: 213,
  pelvis: 90,
  neck: 32,
  head: 22,
  scapula: 9,
  humerus: 12,
  forearm: 7,
  foreCannon: 2,
  femur: 24,
  gaskin: 9,
  hindCannon: 2.5,
  pastern: 1.3,
  hoof: 1.2,
};

/**
 * Where the joints are standing square (m, world, the left side), the proportions of a 16 hh
 * warmblood (approximate), its angles those Matsuura et al. 2008 (J Equine Sci 19:9) measured in
 * riding horses standing: the scapula from high on the withers forward and down to the point of
 * the shoulder at ~60° to the ground (58–61°); the humerus back down to the elbow, the shoulder
 * joint at ~103° (100–105°); the forearm, carpus ("knee"), cannon and fetlock in a plumb line, the
 * elbow at ~133° (133–137°); the pastern sloping forward at ~55° to the coffin joint in the hoof.
 * Behind: the hip joint, the femur forward down to the stifle at ~62° to the ground (59–64°), the
 * tibia back down to the hock, the stifle at ~114° (117–126°), the hind cannon plumb under the
 * hip, the hock at ~142° (141–147°), the pastern sloping forward. Segment lengths of the order
 * Buchner et al. 1997 (J Biomech 30:653) measured in warmbloods of ~1.65 m at the withers: the
 * scapula ~0.40 m, the fore cannon (carpus to fetlock) ~0.23 m, the femur ~0.44 m, the tibia ~0.45 m
 * (its hock ~0.5 m up). A leg so bent standing has the reserve to land straightened and push off
 * with its hock opened.
 */
// Read: Hannoveraner breeding programme (2021), conformation: plumb cannons, pasterns 50–55°.
// https://hanoverian.org.au/wp-content/uploads/2023/11/Breeding_Programme_of_the_Hannoveraner_breed_3.11.2021_01.pdf
// Tuned carriage: poll 13 cm above the scapular top, muzzle 52° below horizontal.
const AT = {
  trunk: v(0, 1.4, 0),
  pelvis: v(0, 1.42, -0.48),
  neck: v(0, 1.39, 0.67),
  poll: v(0, 1.57, 1.30),
  muzzle: v(0, 1.15, 1.63),
  scapula: v(0.12, 1.44, 0.657),
  shoulder: v(0.17, 1.1, 0.857),
  elbow: v(0.17, 0.889, 0.63),
  carpus: v(0.17, 0.47, 0.63),
  foreFetlock: v(0.17, 0.24, 0.63),
  foreCoffin: v(0.17, 0.097, 0.73),
  foreSole: v(0.17, 0, 0.7),
  hip: v(0.15, 1.24, -0.64),
  stifle: v(0.16, 0.852, -0.433),
  hock: v(0.15, 0.5, -0.71),
  hindFetlock: v(0.15, 0.22, -0.71),
  hindCoffin: v(0.15, 0.097, -0.624),
  hindSole: v(0.15, 0, -0.64),
};

/** the bones, parents first: the trunk (root), pelvis, neck, head, then each leg's */
function build(): { bones: BoneDef[]; legs: HorseLeg[] } {
  const bones: BoneDef[] = [];
  const at: Vector3[] = [];
  /** a bone with its joint at `joint` (world, rest), of `mass` centred `k` of the way to `to` */
  const add = (name: string, parent: number, joint: Vector3, mass: number, to: Vector3, k: number) => {
    bones.push({ name, parent, offset: parent < 0 ? joint.clone() : joint.clone().sub(at[parent]), mass, com: to.clone().sub(joint).multiplyScalar(k) });
    at.push(joint);
    return bones.length - 1;
  };
  const trunk = add('trunk', -1, AT.trunk, MASS.trunk, v(0, 1.12, 0.3), 1);
  const pelvis = add('pelvis', trunk, AT.pelvis, MASS.pelvis, v(0, 1.27, -0.68), 1);
  const neck = add('neck', trunk, AT.neck, MASS.neck, AT.poll, 0.45);
  add('head', neck, AT.poll, MASS.head, AT.muzzle, 0.4);
  const legs: HorseLeg[] = [];
  for (const [fore, end] of [[true, 'Fore'], [false, 'Hind']] as const) {
    for (const side of [1, -1] as const) {
      const m = (p: Vector3) => v(side * p.x, p.y, p.z);
      const name = side === 1 ? 'left' : 'right';
      const add2 = (bone: string, parent: number, joint: Vector3, mass: number, to: Vector3, k: number) => add(`${name}${bone}`, parent, m(joint), mass, m(to), k);
      const [fetlock, coffin, sole] = fore ? [AT.foreFetlock, AT.foreCoffin, AT.foreSole] : [AT.hindFetlock, AT.hindCoffin, AT.hindSole];
      let scapula: number | null = null;
      let upper: number;
      let middle: number;
      let cannon: number;
      if (fore) {
        scapula = add2('Scapula', trunk, AT.scapula, MASS.scapula, AT.shoulder, 0.5);
        upper = add2('Humerus', scapula, AT.shoulder, MASS.humerus, AT.elbow, 0.45);
        middle = add2('Forearm', upper, AT.elbow, MASS.forearm, AT.carpus, 0.4);
        cannon = add2('ForeCannon', middle, AT.carpus, MASS.foreCannon, fetlock, 0.45);
      } else {
        upper = add2('Femur', pelvis, AT.hip, MASS.femur, AT.stifle, 0.45);
        middle = add2('Gaskin', upper, AT.stifle, MASS.gaskin, AT.hock, 0.4);
        cannon = add2('HindCannon', middle, AT.hock, MASS.hindCannon, fetlock, 0.45);
      }
      const pastern = add2(`${end}Pastern`, cannon, fetlock, MASS.pastern, coffin, 0.5);
      const hoof = add2(`${end}Hoof`, pastern, coffin, MASS.hoof, sole, 0.5);
      legs.push({ name: `${name}${end}`, fore, side, scapula, upper, middle, cannon, pastern, hoof, sole: m(sole).sub(m(coffin)), toe: m(sole).sub(m(coffin)).add(TOE), heel: m(sole).sub(m(coffin)).add(HEEL) });
    }
  }
  return { bones, legs: LEG_NAMES.map((n) => legs.find((l) => l.name === n) ?? fail(n)) };
}

/** the toe ahead of the sole's middle and the heel behind it (m): a shod hoof ~14 cm long */
const TOE = v(0, 0, 0.075);
const HEEL = v(0, 0, -0.065);

const fail = (what: string): never => {
  throw new Error(`no ${what}`);
};

const DEG = Math.PI / 180;
type Range = Omit<Limit, 'bone'>;
/** a range in degrees: twist about y (the bone's length), swing about z (sideways) and x (fore and aft, + turning a hanging bone's end back) */
const range = (z: [number, number], x: [number, number], twist: [number, number]): Range => ({ axis: 1, swing: [[z[0] * DEG, z[1] * DEG], [x[0] * DEG, x[1] * DEG]], twist: [twist[0] * DEG, twist[1] * DEG] });

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

/** each joint's range of motion: every bone's but the trunk's (it turns freely in the world); throws on a bone without one */
function limitsOf(bones: readonly BoneDef[]): Limit[] {
  const mirror = ([lo, hi]: [number, number]): [number, number] => [-hi, -lo];
  return bones.slice(1).map((b, i) => {
    const r = RANGES[b.name] ?? RANGES[b.name.replace(/^(left|right)/, '')] ?? fail(`range for ${b.name}`);
    // (the right side's sideways swing and twist mirror the left's)
    const right = b.name.startsWith('right');
    return { bone: i + 1, ...r, swing: [right ? mirror(r.swing[0]) : r.swing[0], r.swing[1]], twist: right ? mirror(r.twist) : r.twist };
  });
}

const built = build();
// Tuned diagnostics only: a whole ROM traversed in 30 ms is a gross discontinuity.
// This follows the existing humanoid snap heuristic; it never limits the solver's rates.
for (const limit of limitsOf(built.bones)) {
  const span = Math.max(...[...limit.swing, limit.twist].map(([lo, hi]) => hi - lo)) / DEG;
  const speed = span / 0.03;
  built.bones[limit.bone].snap = { speed, accel: speed / 0.03 };
}
const names = (k: number) => built.bones[k].name;

/** The horse's skeleton: its limits, a chain per leg (named as the leg) and the neck's.
 * Warmblood landmarks: root bone `trunk` (index 0) on the spine under the saddle, `neck` at its base,
 * `head` at the poll; muzzle offset from head is (0, -0.42, 0.33) m. */
export const SKELETON = new Skeleton(built.bones, {
  limits: limitsOf(built.bones),
  chains: Object.fromEntries([...built.legs.map((l) => [l.name, [l.upper, l.middle, l.cannon].map(names)]), ['neck', ['neck', 'head']]]),
});
/** the legs, as LEG_NAMES lists them */
export const LEGS: readonly HorseLeg[] = built.legs;
export const TRUNK = 0;
export const PELVIS = SKELETON.index('pelvis');
export const NECK = SKELETON.index('neck');
export const HEAD = SKELETON.index('head');
/** the eyes' midpoint (in the head's frame) */
export const EYES = v(0, -0.15, 0.13);
/** the muzzle (in the head's frame) */
export const MUZZLE = AT.muzzle.clone().sub(AT.poll);
