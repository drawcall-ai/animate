// A complete custom species: the lion skeleton given its roles and tuning. `new Body(LION_SPECIES)` walks, trots, looks and takes things in its jaw.
import { carriages, footfalls, powerGait, species, swing, type Range } from '@drawcall/animate';
import { LION } from './lion';

type LionBone = (typeof LION)[number]['name'];
const DEG = Math.PI / 180;

/** the legs in the order a four-legged gait and carriage read them: fore-left, fore-right, hind-left, hind-right */
const LEGS = ['leftFore', 'rightFore', 'leftHind', 'rightHind'] as const;
const JOINTS = [0, 1, 2, 3] as const;
/** each leg joint's range (°): sideways, fore and aft (back, forth), twist; for its top, elbow or stifle, wrist or hock, paw */
const RANGES = {
  Fore: [[25, -90, 100, 20], [5, -110, 45, 5], [5, -10, 120, 5], [15, -70, 90, 10]],
  Hind: [[25, -80, 80, 20], [5, -40, 110, 5], [5, -110, 30, 5], [15, -70, 90, 10]],
} as const;
/** each bone's mass (kg), ~190 kg in all; a bone given none weighs nothing */
const MASSES: Partial<Record<LionBone, number>> = { trunk: 60, spine: 30, pelvis: 22, neck: 12, head: 16, jaw: 2, tail: 2, tailTip: 1 };
const LIMITS: Partial<Record<LionBone, Range>> = {};
for (const leg of LEGS) for (const joint of JOINTS) {
  const [sideways, back, forth, twist] = RANGES[leg.endsWith('Fore') ? 'Fore' : 'Hind'][joint];
  MASSES[`${leg}${joint}`] = 8 / (joint + 1);
  LIMITS[`${leg}${joint}`] = { axis: 1, swing: [[-sideways * DEG, sideways * DEG], [back * DEG, forth * DEG]], twist: [-twist * DEG, twist * DEG] };
}

/** footfalls in the legs' order (0…1 of a stride): a lateral-sequence walk, and a trot's diagonal pairs */
const WALK = [0.25, 0.75, 0, 0.5], TROT = [0.5, 0, 0, 0.5];
/** walking, the withers and croup dip a centimetre a step; trotting, the trunk rides its legs' push instead */
const WALKING = { withers: -0.01, croup: [-0.01, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 1, headRise: 0, headWithers: 0.5 } as const;
const TROTTING = { ...WALKING, withers: 0, croup: [0, 0], bounce: 1 } as const;

export const LION_SPECIES = species(LION, {
  // the look shared over neck and head, the eyes on the head (a point in the head bone's frame)
  gaze: { neck: ['neck', 'head'], eyes: { bone: 'head', at: [0, -0.05, 0.2] }, range: { down: 0.4, up: 0.3, side: 0.5 } },
  // its one hand is its mouth: the chain from the neck to the jaw's tip
  hands: { jaw: ['neck', 'head', 'jaw'] },
  // each leg: a ball joint at the top ('yzx': its twist keeps the sole flat), two hinges, a paw that also tilts sideways
  legs: LEGS.map((leg) => ({
    joints: JOINTS.map((joint) => ({ bone: `${leg}${joint}` as const, axes: ['yzx', 'x', 'x', 'zx'][joint] })),
    heel: [0, -0.06, -0.04],
    toe: [0, -0.06, 0.08],
  })),
  // what the gait carries (four legs only), and its quiet life standing: the tail swishing now and then
  carriage: { spine: 'spine', pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.4, period: 0.5, cycles: 3 },
    life: [['tail', { every: [3, 7], rate: 1, pick: swing }]] },
}, {
  gait: {
    // hip height 0.92 m; walking from 0.6 m/s, trotting from a Froude number of 0.6
    ...powerGait({ height: 0.92, slowest: 0.6, offsets: footfalls([[0.3, WALK], [0.6, TROT]]), stride: 2.3, stance: 0.93, clearance: [0.06, 0.06, 0.06, 0.06] }),
    body: carriages([[0.3, WALKING], [0.6, TROTTING]]),
  },
  masses: MASSES,
  limits: LIMITS,
  // pitching head-end down as it speeds up, back as it slows, rolling into a turn
  inertia: { ahead: 0.4, back: 0.3, roll: 0.9, most: 0.3, frequency: 0.79, damping: 0.65 },
});
