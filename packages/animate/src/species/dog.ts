// A dog: a Labrador of ~30 kg, 0.54 m at the withers (the breed's 54–57 cm: read, FCI standard 122), standing square (+Y up, facing +Z,
// its left +X).
import type { SkeletonBone } from '@drawcall/rig';
import type { JointCycle } from './cycle';
import { powerGait } from './schedule';
import { gaitAt } from './scaled';
import { swing } from '../kernel/life';
import { build, needing, type BoneNames, type Having, type LegRole, type Range, type Species } from './define';

/** the bones a dog's skeleton names: each leg's four joints top to paw (`leftFore0` … `leftFore3`, and so on), its trunk, head and tail */
export type DogBone = 'trunk' | 'pelvis' | 'neck' | 'head' | 'jaw' | 'tail' | `${'left' | 'right'}${'Fore' | 'Hind'}${0 | 1 | 2 | 3}`;

/**
 * A dog of a skeleton (as rigged with @drawcall/rig, `as const`), its bones named as `DogBone`: it trots (diagonal pairs), its whole body
 * riding on the trot; it looks about with its neck, takes things in its jaw (its one hand, `jaw`) and wags its tail in bursts standing.
 * Its numbers are a Labrador's of 0.45 m to the trunk, made dynamically similar to the skeleton's size.
 *
 * The trot's carriage: a trotting dog bounces twice a stride, once per diagonal pair, its withers and croup together (derived from the
 * read step frequency 4.31 Hz and peak upward acceleration 10.44 m/s² of a 17.6 kg dog, Cavagna et al. 2010, PMC2817108 Table 1: ±1.4 cm
 * as a sinusoid; ±1.2 cm here at a slower trot); the pelvis rolls under 3° each way in a Whippet and more in a Malinois, and hardly yaws
 * (0–5°) [read: Fischer et al. 2018, Sci Rep 8:16982]; the head dips with each fore stance, as the withers do [recalled: the head nod
 * lameness scores read off]; the tail swings against the pelvis's roll [recalled]. Setting off it pitches head-end down into the
 * acceleration: −14° at the first hind stance against +3–14° galloping, at 14.3 m/s² (read: Walter & Carrier 2009, J Exp Biol 212:1930)
 * — ~0.3–0.5 of atan(a / g) = 56°; braking, a low posture rather than a pitch (read: Wilson et al. 2013, Nature 498:185, cheetahs:
 * "prevents pitching"): less. Round a bend it leans in about as far as atan(v² / r g) (read via summary: Brocklehurst et al. 2014, horses
 * 12.0° at 13.1°). Its spine bends into the turn: a horse's 4–6° thoracolumbar and ~5° more of neck on a 5 m circle (read: Byström et al.
 * 2021, Sci Rep 11:12734; Egenvall et al. 2023) is ~0.4 of the arc its 1.1 m back walks; a dog's back is a little suppler (tuned: 0.45).
 * The trunk's response a person's (0.8 Hz at 0.9 m hips) made dynamically similar on its 0.44 m legs: × √(0.9 / 0.44). On the move it is
 * let down a tenth of its legs' length (`drop`): its forelegs, all but straight standing, reach fore and aft so (a trotting dog's leg
 * shortens in its stance, its elbow and stifle bent [recalled]).
 */
export function dog<const S extends readonly SkeletonBone[]>(skeleton: S & Having<S, DogBone>): Species<BoneNames<S>, 'jaw'> {
  needing(skeleton, ['trunk', 'pelvis', 'neck', 'head', 'jaw', 'tail', ...LEGS.flatMap((leg) => [0, 1, 2, 3].map((k) => `${leg}${k}`))], 'dog');
  const trunk = skeleton.find((bone) => bone.name === 'trunk');
  if (!trunk) throw new Error('dog: the skeleton has no trunk');
  // (its size against the Labrador its numbers are for: the trunk's height)
  const size = trunk.position[1] / TRUNK;
  const masses: Record<string, number> = { trunk: 15, pelvis: 4, neck: 2, head: 2.5, jaw: 0.3, tail: 0.3 };
  const limits: Record<string, Range> = {};
  const legs: LegRole<string>[] = LEGS.map((leg) => {
    const fore = leg.endsWith('Fore');
    for (let k = 0; k < 4; k++) {
      masses[`${leg}${k}`] = 1.5 / (k + 1);
      const [z, back, forth, twist] = RANGES[fore ? 'Fore' : 'Hind'][k];
      limits[`${leg}${k}`] = { axis: 1, swing: [[-z * DEG, z * DEG], [back * DEG, forth * DEG]], twist: [-twist * DEG, twist * DEG] };
    }
    return {
      joints: [0, 1, 2, 3].map((k) => ({ bone: `${leg}${k}`, axes: ['yzx', 'x', 'x', 'zx'][k], cycle: k === 2 ? (fore ? CARPUS : HOCK) : undefined })),
      heel: [0, -0.035 * size, -0.015 * size],
      toe: [0, -0.035 * size, 0.05 * size],
    };
  });
  const made = build(skeleton, {
    root: 'trunk',
    gaze: { neck: ['neck', 'head'], eyes: { bone: 'head', at: [0, -0.02 * size, 0.1 * size] }, range: { down: 0.5, up: 0.4, side: 0.6 } },
    hands: { jaw: ['neck', 'head', 'jaw'] },
    legs,
    carriage: { pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.6, period: 0.35, cycles: 6 },
      life: [['tail', { every: [2, 5], rate: 1, pick: swing }]] },
  }, {
    gait: gaitAt({ ...powerGait({ height: 0.49, slowest: 0.3, offsets: TROT, stride: 2.15, stance: 0.93, clearance: [0.025, 0.025, 0.02, 0.02] }), drop: 0.1, body: TROTTING }, size),
    masses: Object.fromEntries(Object.entries(masses).map(([name, mass]) => [name, mass * size ** 3])),
    limits,
    inertia: { ahead: 0.4, back: 0.3, roll: 0.9, most: 0.3, frequency: 1.15 / Math.sqrt(size), damping: 0.65 },
  });
  return { ...made, bones: skeleton, scale: size };
}

/** the trunk's height of the Labrador the dog's numbers are for (m) */
const TRUNK = 0.45;
const DEG = Math.PI / 180;
const LEGS = ['leftFore', 'rightFore', 'leftHind', 'rightHind'] as const;
// each leg joint's range off standing (°): sideways, fore and aft (+ its end back), twist — top, elbow or stifle, carpus or hock, paw. The
// elbow folds 100° and opens to all but straight (scapula and humerus are one segment here); the carpus folds 110° in the swing and
// gives 30° more under load (a Labrador's carpus 32–192° passively, its elbow 36–165°: read via Lappalainen et al. 2023, Front Vet Sci
// 9:1099903, of Jaegger et al. 2002); the stifle and hock open past standing to ~146° and ~160°, and fold to ~21° and ~55°.
const RANGES: Record<'Fore' | 'Hind', readonly (readonly [number, number, number, number])[]> = {
  Fore: [[25, -70, 70, 20], [5, -100, 30, 5], [5, -30, 110, 5], [15, -60, 90, 10]],
  Hind: [[25, -70, 70, 20], [5, -25, 100, 5], [5, -70, 35, 5], [15, -60, 90, 10]],
};
// footfalls (fore-left, fore-right, hind-left, hind-right): a trot, on diagonal pairs, at every pace — a Labrador trots at 1.9–2.3 m/s,
// 2.2 strides a second of 1.05 m (read: Humphries et al. 2020, PLOS ONE e0239832; Charles et al. 2025, J Exp Biol 228:jeb250523), a dog's
// duty factor 0.42 trotting (read: Fischer et al. 2018, Malinois); `powerGait`'s stride and stance scale those to its pace
const TROT = [0.52, 0.02, 0, 0.5];
// how the carpus and hock follow the stride (° off standing, + the paw's end forward; `u` from landing, its stance over at 0.45): the
// carpus straight under load in the stance, then folding the paw up and back, ~90° by mid-swing, and opening again to land — a trotting
// dog's carpus flexes ~90–100° in the swing (read: Miao et al. 2026, Front Vet Sci 13:1878605, German Shepherds, 88.7° swing excursion;
// Charles et al. 2025, Labradors, ~100°); the hock giving ~10° as the paw lands, opening to push off and flexing ~45° in the swing (Miao
// et al.: a 56.5° swing excursion); the elbow and stifle bend as the paw's path asks
const CARPUS: JointCycle = { duty: 0.45, keys: [[0, 5], [0.3, 10], [0.45, 0], [0.55, -50], [0.68, -90], [0.82, -40], [0.95, 0]] };
const HOCK: JointCycle = { duty: 0.45, keys: [[0, 5], [0.15, 10], [0.4, -10], [0.5, 10], [0.65, 45], [0.82, 15], [0.95, 0]] };
// how it carries itself trotting: bouncing twice a stride on its diagonals, withers and croup together, its back held stiff in the
// sagittal plane (read: Schilling & Carrier 2010, J Exp Biol 213:1490), its pelvis rolling and yawing with the hind legs' stance (a German
// Shepherd's 9° of roll and 6° of yaw over a trot's stride: read, Schaub et al. 2021, Front Vet Sci 8:709966; a Whippet's under 3° each
// way: read, Fischer et al. 2018; a Labrador's between), its head carried nearly level, riding with the withers and nodding a little
const TROTTING = { bend: 0.45, withers: -0.012, croup: [-0.012, 0], spine: 0, spinePhase: 0, roll: 3, yaw: 1.5, headPitch: 2, headRise: 0, headWithers: 1 } as const;
