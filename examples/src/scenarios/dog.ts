import { Box3, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { Body, grab, hold, Item, powerGait, Skeleton, swing, walkTo, type Frame, type Species } from '@drawcall/animate';
import { idle } from '@drawcall/animate/rig';
import { Report } from '../report';
import type { Scenario } from '../scenario';
import { skeletonProps } from '../stage/props';

// A dog, as data only: ~30 kg, 0.55 m at the withers, standing square (+Y up, facing +Z, its left +X).
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
/** A dog's body, its head and jaw where `neck` puts them standing square (world): `DOG`'s, or a shorter neck's. */
function fourLegged(neck: { head: Vector3; jaw: Vector3 }): Species<'jaw'> {
  /** each bone: its name, its parent's, where its joint is standing square (world), its mass (kg) */
  const joints: [string, string, Vector3, number][] = [['trunk', '', v(0, 0.46, 0), 15], ['pelvis', 'trunk', v(0, 0.45, -0.16), 4],
    ['neck', 'trunk', v(0, 0.44, 0.27), 2], ['head', 'neck', neck.head, 2.5], ['jaw', 'head', neck.jaw, 0.3],
    ['tail', 'pelvis', v(0, 0.47, -0.32), 0.3]];
  for (const leg of legs) {
    // (top, knee or elbow, hock or wrist, paw: the elbow bends back, the stifle forward)
    const x = leg.startsWith('left') ? 0.08 : -0.08, fore = leg.endsWith('Fore'), z = fore ? 0.22 : -0.24, knee = fore ? -0.06 : 0.1;
    [v(x, 0.43, z), v(x, 0.28, z + knee), v(x, 0.1, z - knee / 2), v(x, 0.03, z)]
      .forEach((at, k) => joints.push([`${leg}${k}`, k ? `${leg}${k - 1}` : fore ? 'trunk' : 'pelvis', at, 1.5 / (k + 1)]));
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
      chains: legs.map((leg) => ({ joints: [0, 1, 2, 3].map((k) => ({ bone: skeleton.index(`${leg}${k}`), axes: ['yzx', 'x', 'x', 'zx'][k] })),
        heel: v(0, -0.03, -0.02), toe: v(0, -0.03, 0.04), toeOut: 0, rocker: [[0, 0], [1, 0]] })),
      gait: {
        ...powerGait({ height: 0.44, slowest: 0.3, offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: 0.93, clearance: [0.03, 0.03, 0.03, 0.03] }),
        body: { bend: 0.6, withers: -0.012, croup: [-0.012, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 2, headRise: 0, headWithers: 1 },
      },
      carriage: { pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.6, period: 0.35, cycles: 6 },
        life: [['tail', { every: [2, 5], rate: 1, pick: swing }]] },
    },
  };
}
const legs = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];
// each leg joint's range (°, as a horse's, a little wider): sideways, fore and aft (+ its end back), twist — top, knee or elbow, hock or wrist, paw
const RANGES: Record<string, number[][]> = { Fore: [[25, -70, 70, 20], [5, -100, 30, 5], [5, -10, 110, 5], [15, -60, 90, 10]],
  Hind: [[25, -70, 70, 20], [5, -40, 100, 5], [5, -100, 30, 5], [15, -60, 90, 10]] };
const deg = Math.PI / 180;

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
 * 1.1 m back walks; a dog's back is suppler (tuned: 0.6). The trunk's response a person's (0.8 Hz at 0.9 m hips) made dynamically
 * similar on its 0.44 m legs: × √(0.9 / 0.44).
 */
export const DOG: Species<'jaw'> = fourLegged({ head: v(0, 0.62, 0.45), jaw: v(0, 0.54, 0.67) });

/** the dog with a neck as short as a cat's for its size: its jaw no nearer the floor than its body lets down and bows for */
export const SHORT_NECKED: Species<'jaw'> = fourLegged({ head: v(0, 0.52, 0.36), jaw: v(0, 0.46, 0.47) });

export function dogFetch(): Scenario {
  return {
    id: 'dog-fetch', title: 'A dog fetches a ball', duration: 20, actors: [], cameraDistance: 3, cameraAngles: { side: Math.PI / 2 },
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
