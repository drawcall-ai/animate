import { Box3, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { Body, grab, hold, idle, Item, Life, powerGait, Skeleton, swing, walkTo, type BoneDef, type Frame, type LegChain, type Limit, type Species } from '@drawcall/animate';
import { Report } from '../report';
import type { Scenario } from '../scenario';
import { skeletonProps } from '../stage/props';

// A dog, as data only: a ~30 kg dog 0.55 m at the withers standing square (+Y up, facing +Z, its left +X).
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const DEG = Math.PI / 180;
/** a range (°): sideways swing, fore-and-aft swing (+ turning the bone's end back), twist */
const range = (z: number, [back, forth]: [number, number], twist: number): Omit<Limit, 'bone'> =>
  ({ axis: 1, swing: [[-z * DEG, z * DEG], [back * DEG, forth * DEG]], twist: [-twist * DEG, twist * DEG] });

/** each bone: its parent, where its joint stands (world), its mass (kg), its range */
const BONES: [string, string, Vector3, number, Omit<Limit, 'bone'>?][] = [
  ['trunk', '', v(0, 0.46, 0), 19],
  ['neck', 'trunk', v(0, 0.44, 0.27), 2, range(30, [-120, 120], 45)],
  ['head', 'neck', v(0, 0.62, 0.45), 2.5, range(30, [-90, 90], 30)],
  ['jaw', 'head', v(0, 0.54, 0.67), 0.3],
  ['tail', 'trunk', v(0, 0.47, -0.32), 0.3, range(60, [-60, 60], 60)],
];
/** a leg's joints from the top (shoulder, hip) to the paw, the left side's, and each one's range */
const LEGS = {
  Fore: [[v(0.08, 0.42, 0.24), 1.2, range(40, [-45, 45], 30)], [v(0.08, 0.27, 0.19), 0.5, range(5, [-90, 25], 5)],
    [v(0.08, 0.1, 0.21), 0.2, range(5, [-10, 110], 5)], [v(0.08, 0.03, 0.24), 0.1, range(20, [-45, 100], 20)]],
  Hind: [[v(0.07, 0.44, -0.24), 1.5, range(40, [-55, 40], 30)], [v(0.07, 0.29, -0.15), 0.6, range(5, [-40, 75], 5)],
    [v(0.07, 0.12, -0.28), 0.2, range(5, [-85, 28], 5)], [v(0.07, 0.03, -0.25), 0.1, range(20, [-45, 100], 20)]],
} as const;
for (const [end, joints] of Object.entries(LEGS)) for (const side of ['left', 'right']) {
  const x = side === 'left' ? 1 : -1;
  joints.forEach(([at, mass, limit], k) => BONES.push([`${side}${end}${k}`, k ? `${side}${end}${k - 1}` : 'trunk', v(x * at.x, at.y, at.z), mass,
    { ...limit, swing: [x > 0 ? limit.swing[0] : [-limit.swing[0][1], -limit.swing[0][0]], limit.swing[1]] }]));
}
const index = (name: string) => BONES.findIndex(([n]) => n === name);
const SKELETON = new Skeleton(
  BONES.map(([name, parent, at, mass]): BoneDef => ({ name, parent: index(parent), offset: parent ? at.clone().sub(BONES[index(parent)][2]) : at.clone(), mass, com: new Vector3() })),
  { limits: BONES.flatMap(([, , , , limit], bone) => limit ? [{ bone, ...limit }] : []), chains: { neck: ['neck', 'head'], mouth: ['neck', 'head', 'jaw'] } },
);
const legChain = (name: string): LegChain => ({
  joints: [0, 1, 2, 3].map((k) => ({ bone: index(`${name}${k}`), axes: ['yzx', 'x', 'x', 'zx'][k] })),
  heel: v(0, -0.03, -0.02), toe: v(0, -0.03, 0.04), toeOut: 0, rocker: [[0, 0], [1, 0]],
});
const TAIL = index('tail'), HEAD = index('head');

/** the dog: it trots (diagonal pairs), looks about with its neck, takes things in its jaw and wags its tail in bursts */
export const DOG: Species = {
  skeleton: SKELETON,
  gaze: { neck: 'neck', eyes: (pose, out) => pose.point(HEAD, v(0, -0.02, 0.1), out), range: { down: 0.5, up: 0.4, side: 0.6 } },
  hands: { jaw: 'mouth' },
  legs: {
    chains: ['leftFore', 'rightFore', 'leftHind', 'rightHind'].map(legChain),
    gait: powerGait({ height: 0.44, slowest: 0.3, offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: 0.33, clearance: [0.03, 0.03, 0.03, 0.03] }),
    posture: () => {
      const life = new Life(7, [['wag', { every: [2, 5], hold: [1, 3], rate: 4, pick: swing }]]);
      return { prepare: (f) => {
        life.update(f.time, f.dt);
        f.current.setLocal(TAIL, new Quaternion().setFromAxisAngle(v(0, 1, 0), 0.6 * Math.abs(life.value('wag')) * Math.sin(18 * f.time)));
      } };
    },
  },
};

export function dogFetch(): Scenario {
  return {
    id: 'dog-fetch', title: 'A dog fetches a ball', duration: 14, actors: [], cameraDistance: 4,
    description: 'A dog made of data only (skeleton, legs and gait, gaze, a jaw, a tail wag) trots to a ball, takes it in its jaw and carries it back.',
    stage: (dev = false) => {
      const ball = new Item(v(1, 0.04, 4), new Quaternion(), { middle: { position: new Vector3() } },
        { name: 'ball', mass: 0.06, bounds: new Box3(v(-0.04, -0.04, -0.04), v(0.04, 0.04, 0.04)) });
      let back = false;
      const dog: Body = new Body(DOG, () => parallel<Frame>('all', idle(dog), function* () {
        yield* grab(dog, { jaw: [ball, 'middle'] })();
        yield* parallel<Frame>('race', hold(dog, ball), walkTo(dog, { to: v(0, 0, 0.5) }));
        back = true;
      }), { dev });
      return {
        report: new Report(), bodies: [dog],
        props: () => [...skeletonProps(dog.pose), { kind: 'ball', position: ball.current.position.clone(), radius: 0.04 }],
        done: () => back && dog.holding.jaw?.item === ball,
        script: () => { throw new Error('the dog scenario has no humanoids'); },
      };
    },
  };
}
