import { Box3, Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { Body, grab, hold, idle, Item, Life, powerGait, Skeleton, swing, walkTo, type Frame, type Species } from '@drawcall/animate';
import { Report } from '../report';
import type { Scenario } from '../scenario';
import { skeletonProps } from '../stage/props';

// A dog, as data only: ~30 kg, 0.55 m at the withers, standing square (+Y up, facing +Z, its left +X).
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
/** each bone: its name, its parent's, where its joint is standing square (world), its mass (kg) */
const joints: [string, string, Vector3, number][] = [['trunk', '', v(0, 0.46, 0), 19], ['neck', 'trunk', v(0, 0.44, 0.27), 2],
  ['head', 'neck', v(0, 0.62, 0.45), 2.5], ['jaw', 'head', v(0, 0.54, 0.67), 0.3], ['tail', 'trunk', v(0, 0.47, -0.32), 0.3]];
const legs = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];
for (const leg of legs) {
  // (top, knee or elbow, hock or wrist, paw: the elbow bends back, the stifle forward)
  const x = leg.startsWith('left') ? 0.08 : -0.08, fore = leg.endsWith('Fore'), z = fore ? 0.22 : -0.24, knee = fore ? -0.04 : 0.08;
  [v(x, 0.43, z), v(x, 0.28, z + knee), v(x, 0.1, z - knee / 2), v(x, 0.03, z)].forEach((at, k) => joints.push([`${leg}${k}`, k ? `${leg}${k - 1}` : 'trunk', at, 1.5 / (k + 1)]));
}
const at = (name: string) => joints.find(([n]) => n === name)![2];
const skeleton = new Skeleton(joints.map(([name, parent, joint, mass]) => ({ name, parent: joints.findIndex(([n]) => n === parent), offset: parent ? joint.clone().sub(at(parent)) : joint, mass, com: v(0, 0, 0) })),
  { chains: { neck: ['neck', 'head'], mouth: ['neck', 'head', 'jaw'] } });
const TAIL = skeleton.index('tail'), HEAD = skeleton.index('head');

/** the dog: it trots (diagonal pairs), looks about with its neck, takes things in its jaw and wags its tail in bursts */
export const DOG: Species = {
  skeleton,
  gaze: { neck: 'neck', eyes: (pose, out) => pose.point(HEAD, v(0, -0.02, 0.1), out), range: { down: 0.5, up: 0.4, side: 0.6 } },
  hands: { jaw: 'mouth' },
  legs: {
    chains: legs.map((leg) => ({ joints: [0, 1, 2, 3].map((k) => ({ bone: skeleton.index(`${leg}${k}`), axes: ['yzx', 'x', 'x', 'zx'][k] })),
      heel: v(0, -0.03, -0.02), toe: v(0, -0.03, 0.04), toeOut: 0, rocker: [[0, 0], [1, 0]] })),
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
