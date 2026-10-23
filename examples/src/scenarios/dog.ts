import { Box3, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { Body, grab, hold, Item, powerGait, Skeleton, swing, walkTo, type Frame, type JointCycle, type Species } from '@drawcall/animate';
import { idle } from '@drawcall/animate/rig';
import { Report } from '../report';
import type { Scenario } from '../scenario';
import { skeletonProps } from '../stage/props';

// A dog, as data only: a Labrador of ~30 kg, 0.55 m at the withers, standing square (+Y up, facing +Z, its left +X). Its joints are
// where the rigged mesh it is shown as has them (measured on `examples/public/models/dog.glb`, left and right averaged), so the skin
// bends where the body does and hardly stretches; standing so, its legs are a Labrador's (see `LEG`).
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
/** A dog's body, its head and jaw where `neck` puts them standing square (world): `DOG`'s, or a shorter neck's. */
function fourLegged(neck: { head: Vector3; jaw: Vector3 }): Species<'jaw'> {
  /** each bone: its name, its parent's, where its joint is standing square (world), its mass (kg) */
  const joints: [string, string, Vector3, number][] = [['trunk', '', v(0, 0.45, 0.04), 15], ['pelvis', 'trunk', v(0, 0.46, -0.21), 4],
    ['neck', 'trunk', v(0, 0.46, 0.24), 2], ['head', 'neck', neck.head, 2.5], ['jaw', 'head', neck.jaw, 0.3],
    ['tail', 'pelvis', v(0, 0.48, -0.32), 0.3]];
  for (const leg of legs) {
    const side = leg.startsWith('left') ? 1 : -1, fore = leg.endsWith('Fore');
    LEG[fore ? 'Fore' : 'Hind'].forEach(([x, y, z], k) => joints.push([`${leg}${k}`, k ? `${leg}${k - 1}` : fore ? 'trunk' : 'pelvis', v(side * x, y, z), 1.5 / (k + 1)]));
  }
  const at = (name: string) => joints.find(([n]) => n === name)![2];
  const skeleton = new Skeleton(joints.map(([name, parent, joint, mass]) => ({ name, parent: joints.findIndex(([n]) => n === parent), offset: parent ? joint.clone().sub(at(parent)) : joint, mass, com: v(0, 0, 0) })), {
    chains: { neck: ['neck', 'head'], mouth: ['neck', 'head', 'jaw'] },
    limits: joints.flatMap(([name], bone) => {
      const [, end, k] = /^(?:left|right)(Fore|Hind)(\d)$/.exec(name) ?? [];
      if (!end) return [];
      const [z, back, forth, twist] = RANGES[end][Number(k)];
      return [{ bone, axis: 1 as const, swing: [[-z * deg, z * deg], [back * deg, forth * deg]] as [[number, number], [number, number]], twist: [-twist * deg, twist * deg] as [number, number] }];
    }),
  });
  return {
    skeleton,
    gaze: { neck: 'neck', eyes: (pose, out) => pose.point(skeleton.index('head'), v(0, -0.02, 0.1), out), range: { down: 0.5, up: 0.4, side: 0.6 } },
    hands: { jaw: 'mouth' },
    inertia: { ahead: 0.4, back: 0.3, roll: 0.9, most: 0.3, frequency: 1.15, damping: 0.65 },
    legs: {
      chains: legs.map((leg) => ({ joints: [0, 1, 2, 3].map((k) => ({ bone: skeleton.index(`${leg}${k}`), axes: ['yzx', 'x', 'x', 'zx'][k],
          cycle: k === 2 ? (leg.endsWith('Fore') ? CARPUS : HOCK) : undefined })),
        heel: v(0, -0.035, -0.015), toe: v(0, -0.035, 0.05), toeOut: 0, rocker: [[0, 0], [1, 0]] })),
      gait: {
        ...powerGait({ height: 0.49, slowest: 0.3, offsets: TROT, stride: 2.15, stance: 0.93, clearance: [0.025, 0.025, 0.02, 0.02] }),
        drop: 0.1,
        body: TROTTING,
      },
      carriage: { pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.6, period: 0.35, cycles: 6 },
        life: [['tail', { every: [2, 5], rate: 1, pick: swing }]] },
    },
  };
}
const legs = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];
/**
 * Each left leg's joints standing (m, world): top, elbow or stifle, carpus or hock, paw — the mesh's. The foreleg's top is high on the
 * scapula, its line to the elbow (scapula and humerus as one) and the forearm plumb under the withers, the pastern sloping forward;
 * behind, the stifle at ~135° and the hock at ~133°, the hind cannon near plumb — Labradors stand at a stifle of 132–139° and a tarsus
 * of 133–141° (see `STANDING`).
 */
const LEG: Record<string, [number, number, number][]> = {
  Fore: [[0.07, 0.474, 0.238], [0.06, 0.297, 0.169], [0.075, 0.094, 0.231], [0.081, 0.035, 0.271]],
  Hind: [[0.07, 0.474, -0.233], [0.054, 0.302, -0.191], [0.064, 0.165, -0.329], [0.077, 0.035, -0.308]],
};
// each leg joint's range off standing (°): sideways, fore and aft (+ its end back), twist — top, elbow or stifle, carpus or hock, paw. The
// elbow folds 100° and opens only to straight (scapula and humerus are one segment here); the carpus folds 110° in the swing and gives
// 15° more under load; the stifle and hock open past standing to ~160° and ~168°, and fold to ~35° and ~63°.
const RANGES: Record<string, number[][]> = { Fore: [[25, -70, 70, 20], [5, -100, 30, 5], [5, -30, 110, 5], [15, -60, 90, 10]],
  Hind: [[25, -70, 70, 20], [5, -25, 100, 5], [5, -70, 35, 5], [15, -60, 90, 10]] };
const deg = Math.PI / 180;
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

/**
 * The dog: it trots (diagonal pairs), its whole body riding on the trot; it looks about with its neck, takes things in its jaw and
 * wags its tail in bursts standing. The trot's carriage: a trotting dog bounces twice a stride, once per diagonal pair, its withers
 * and croup together ([D] from the read step frequency 4.31 Hz and peak upward acceleration 10.44 m/s² of a 17.6 kg dog, Cavagna et
 * al. 2010, PMC2817108 Table 1: ±1.4 cm as a sinusoid; ±1.2 cm here at a slower trot); the pelvis rolls under 3° each way in a Whippet
 * and more in a Malinois, and hardly yaws (0–5°) [read: Fischer et al. 2018, Sci Rep 8:16982]; the head dips with each fore stance,
 * as the withers do [recalled: the head nod lameness scores read off]; the tail swings against the pelvis's roll [recalled].
 * Setting off it pitches head-end down into the acceleration: −14° at the first hind stance against +3–14° galloping, at 14.3 m/s²
 * (read: Walter & Carrier 2009, J Exp Biol 212:1930) — ~0.3–0.5 of atan(a / g) = 56°; braking, a low posture rather than a pitch
 * (read: Wilson et al. 2013, Nature 498:185, cheetahs: "prevents pitching"): less. Round a bend it leans in about as far as atan(v² / r g)
 * (read via summary: Brocklehurst et al. 2014, horses 12.0° at 13.1°). Its spine bends into the turn: a horse's 4–6° thoracolumbar
 * and ~5° more of neck on a 5 m circle (read: Byström et al. 2021, Sci Rep 11:12734; Egenvall et al. 2023) is ~0.4 of the arc its
 * 1.1 m back walks; a dog's back is a little suppler (tuned: 0.45). The trunk's response a person's (0.8 Hz at 0.9 m hips) made dynamically
 * similar on its 0.44 m legs: × √(0.9 / 0.44).
 */
export const DOG: Species<'jaw'> = fourLegged({ head: v(0, 0.59, 0.33), jaw: v(0, 0.53, 0.5) });

/** the dog with a neck as short as a cat's for its size: its jaw no nearer the floor than its body lets down and bows for */
export const SHORT_NECKED: Species<'jaw'> = fourLegged({ head: v(0, 0.53, 0.31), jaw: v(0, 0.48, 0.43) });

export function dogFetch(): Scenario {
  return {
    id: 'dog-fetch', title: 'A dog fetches a ball', duration: 20, actors: [], skins: ['models/dog.glb'], cameraDistance: 3, cameraAngles: { side: Math.PI / 2 },
    description: 'A dog made of data only (skeleton, legs and gait, gaze, a jaw, a tail wag) trots to a ball, takes it in its jaw and carries it back.',
    stage: (dev = false) => {
      const ball = new Item(v(4, 0.04, 4), new Quaternion(), { middle: { position: new Vector3() } },
        { name: 'ball', mass: 0.06, bounds: new Box3(v(-0.04, -0.04, -0.04), v(0.04, 0.04, 0.04)) });
      let back = false;
      const dog = new Body(DOG, (dog) => function* () {
        yield* grab(dog, { jaw: [ball, 'middle'] })();
        yield* parallel<Frame>('race', hold(dog, ball), walkTo(dog, { to: v(0, 0, 0.5) }));
        back = true;
      }, { dev });
      return {
        report: new Report(), bodies: [dog],
        props: () => [...skeletonProps(dog.pose, 0.014), { kind: 'ball', position: ball.current.position.clone(), radius: 0.04 }],
        done: () => back && dog.holding.jaw?.item === ball,
        script: () => { throw new Error('the dog scenario has no humanoids'); },
      };
    },
  };
}
