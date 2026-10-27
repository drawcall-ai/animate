import { Group, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { species, walkTo } from '@drawcall/animate';
import { carriages, footfalls, powerGait, swing, type Range } from '@drawcall/animate/species';
import type { Scenario } from '../scenario';
import { LION } from '../skeletons';
import { ball } from '../things';

type LionBone = (typeof LION)[number]['name'];

const DEG = Math.PI / 180;
/** its legs, as a species lists them: fore-left, fore-right, hind-left, hind-right; each with its top, elbow or stifle, wrist or hock, paw */
const LEGS = ['leftFore', 'rightFore', 'leftHind', 'rightHind'] as const;
const JOINTS = [0, 1, 2, 3] as const;
// each leg joint's range (°): sideways, fore and aft (+ its end back), twist — top, elbow or stifle, wrist or hock, paw
const RANGES = {
  Fore: [[25, -90, 100, 20], [5, -110, 45, 5], [5, -10, 120, 5], [15, -70, 90, 10]],
  Hind: [[25, -80, 80, 20], [5, -40, 110, 5], [5, -110, 30, 5], [15, -70, 90, 10]],
} as const;
/** each bone's mass (kg): ~190 kg in all */
const MASSES: Partial<Record<LionBone, number>> = { trunk: 60, spine: 30, pelvis: 22, neck: 12, head: 16, jaw: 2, tail: 2, tailTip: 1 };
const LIMITS: Partial<Record<LionBone, Range>> = {};
for (const leg of LEGS) for (const joint of JOINTS) {
  const [sideways, back, forth, twist] = RANGES[leg.endsWith('Fore') ? 'Fore' : 'Hind'][joint];
  MASSES[`${leg}${joint}`] = 8 / (joint + 1);
  LIMITS[`${leg}${joint}`] = { axis: 1, swing: [[-sideways * DEG, sideways * DEG], [back * DEG, forth * DEG]], twist: [-twist * DEG, twist * DEG] };
}

// footfalls (fore-left, fore-right, hind-left, hind-right): a lateral-sequence walk, a trot, a rotary gallop leading with the left fore —
// the right fore down first, then the left, the gathered flight, the left hind, the right hind, the extended flight [read: Hudson, Corr &
// Wilson 2012, J Exp Biol 215:2425, Fig. 2: a cheetah's and a greyhound's at 9–18 m/s]
const WALK = [0.25, 0.75, 0, 0.5], TROT = [0.5, 0, 0, 0.5], GALLOP = [0.65, 0.55, 0, 0.1];
// how it carries itself: walking, its withers and croup dipping a centimetre with each step (tuned: a walk vaults over its legs, its
// rise and fall small); trotting and galloping, riding its legs' push (`bounce`: its centre of mass falling as in flight between stances
// and pitching as the fores and hinds push in turn — a cheetah's centre of mass rises and falls 5.7 ± 1.2 cm a stride at 15–18 m/s and
// its body pitches 11.5° [read: Front Bioeng Biotechnol 2022, 10:825638, PMC9049215, measured cheetahs], a Thoroughbred's 8.3 cm
// and 19° at 17 m/s, 18.5 cm and 11° at 7 [read: Pfau et al. 2006, J Exp Biol 209:3742]); galloping, the spine extended in the extended
// flight and flexed in the gathered one [read: the same: a cheetah's 27° a stride; recalled: Hildebrand 1959; ±12° here,
// less than a cheetah's], the head held steady as the trunk bounces — pitching about a third as much as the trunk [read: a cheetah's
// head-to-torso pitch 0.37, bioRxiv 2026.09.03.748592], rising a tenth as much as the withers (tuned) — the tail swinging against the
// croup's pitch [recalled: the tail as a counterweight]
const WALKING = { withers: -0.01, croup: [-0.01, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 1, headRise: 0, headWithers: 0.5 } as const;
const TROTTING = { ...WALKING, withers: 0, croup: [0, 0], bounce: 1 } as const;
const GALLOPING = { withers: 0, croup: [0, 0], spine: 12, spinePhase: 4.1, roll: 1, yaw: 1, headPitch: 0, headRise: 0, headWithers: 0.1, once: 1, tail: 0.8, bounce: 1 } as const;

/**
 * A lion of ~190 kg, 1.0 m at the withers: it walks, trots from a Froude number of 0.6 and gallops from 3 (walk–trot ~0.5, trot–gallop
 * 2–3 [recalled: Alexander & Jayes 1983]; 4.7 m/s here against 5.4 m/s from Heglund, Taylor & McMahon 1974's 1.535 M^0.24 for 190 kg
 * [recalled]), its gait's stride and stance as `powerGait` scales them: at 14 m/s (a lion's 98th-percentile speed 13.9 m/s [snippet:
 * Wilson et al. 2018, Nature 554:183]) ~3 strides a second, each paw down a fifth of it [read: Hudson et al. 2012, a cheetah's 2.4–3.2 Hz
 * at 9–17 m/s and duty falling with speed], with two flights a stride. Galloping it runs lower on its legs (`run`), so they reach further
 * fore and aft. It pitches head-end down into its acceleration as a dog does (read: Walter & Carrier 2009, J Exp Biol 212:1930), its
 * trunk's response a dog's made dynamically similar on its 0.92 m legs.
 */
export const LION_SPECIES = species(LION, {
  gaze: { neck: ['neck', 'head'], eyes: { bone: 'head', at: [0, -0.05, 0.2] }, range: { down: 0.4, up: 0.3, side: 0.5 } },
  hands: { jaw: ['neck', 'head', 'jaw'] },
  legs: LEGS.map((leg) => ({
    joints: JOINTS.map((joint) => ({ bone: `${leg}${joint}` as const, axes: ['yzx', 'x', 'x', 'zx'][joint] })),
    heel: [0, -0.06, -0.04],
    toe: [0, -0.06, 0.08],
  })),
  carriage: { spine: 'spine', pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.4, period: 0.5, cycles: 3 },
    life: [['tail', { every: [3, 7], rate: 1, pick: swing }]] },
}, {
  gait: {
    ...powerGait({ height: 0.92, slowest: 0.6, offsets: footfalls([[0.3, WALK], [0.6, TROT], [2, TROT], [3, GALLOP]]), stride: 2.3, stance: 0.93, clearance: [0.06, 0.06, 0.06, 0.06] }),
    run: { froude: [1, 3], drop: 0.15 },
    body: carriages([[0.3, WALKING], [0.6, TROTTING], [2, TROTTING], [3, GALLOPING]]),
  },
  masses: MASSES,
  limits: LIMITS,
  inertia: { ahead: 0.4, back: 0.3, roll: 0.9, most: 0.3, frequency: 0.79, damping: 0.65 },
});

/**
 * where the prey stands as the lion sets off (m); how near the lion walks before it trots, and comes before the prey bolts and before it
 * breaks away (m); the prey's pace bolting and breaking away (m/s)
 */
const PREY = { at: new Vector3(0, 0.3, 42), trots: 36, bolts: 22, breaks: 4, pace: 9, escape: 16 };

/** A lion stalks its prey, runs it down at a gallop, and gives up as it breaks away. */
export function lionRun(): Scenario {
  return {
    id: 'lion-run',
    title: 'A lion runs down its prey',
    description: 'A lion walks and trots toward its prey down a long field; as it bolts, the lion breaks into a full rotary gallop after it, then gives up the chase as it breaks away, slows and stops.',
    duration: 34,
    cameraDistance: 4.5,
    cameraAngles: { side: Math.PI / 2 },
    stage: (cast) => {
      const lion = cast.body(LION_SPECIES);
      const scene = new Group();
      const prey = ball(scene, 'prey', 0.3, PREY.at);
      const gap = () => prey.position.z - lion.position.z;
      let pace = 0, stopped = false;
      return {
        scene,
        bodies: [lion],
        // (the prey runs at its pace as the lion walks, trots and gallops after it)
        story: () => parallel('all', action({ update: (_, clock) => void (prey.position.z += pace * clock.delta) }), function* () {
          yield* walkTo(lion, prey, { speed: 1.3, accel: 1.2, until: () => gap() < PREY.trots });
          yield* walkTo(lion, prey, { speed: 3.5, accel: 2, until: () => gap() < PREY.bolts });
          pace = PREY.pace;
          yield* walkTo(lion, prey, { speed: 14, accel: 3, until: () => gap() < PREY.breaks });
          pace = PREY.escape;
          // (it gives up: slows over as far as it takes to stop from its gallop, and stands)
          stopped = yield* walkTo(lion, lion.position.add(new Vector3(0, 0, 36)), { speed: 4, accel: 3 });
        }),
        done: () => stopped,
      };
    },
  };
}
