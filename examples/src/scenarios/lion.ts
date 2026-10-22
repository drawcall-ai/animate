import { Vector3 } from 'three';
import { Body, carriages, footfalls, powerGait, Skeleton, swing, walkTo, type Species } from '@drawcall/animate';
import { Report } from '../report';
import type { Scenario } from '../scenario';
import { skeletonProps } from '../stage/props';

// A lion, as data only: ~190 kg, 1.0 m at the withers, standing square (+Y up, facing +Z, its left +X).
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
/** each bone: its name, its parent's, where its joint is standing square (world), its mass (kg) */
const joints: [string, string, Vector3, number][] = [['trunk', '', v(0, 0.97, 0.2), 60], ['spine', 'trunk', v(0, 0.97, -0.15), 30],
  ['pelvis', 'spine', v(0, 0.95, -0.42), 22], ['neck', 'trunk', v(0, 0.95, 0.55), 12], ['head', 'neck', v(0, 1.15, 0.86), 16],
  ['jaw', 'head', v(0, 1.0, 1.1), 2], ['tail', 'pelvis', v(0, 0.97, -0.62), 2], ['tailTip', 'tail', v(0, 0.45, -1.2), 1]];
const legs = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];
for (const leg of legs) {
  // (top, elbow or stifle, wrist or hock, paw: the elbow bends back, the stifle forward, the hock high and back as a cat's)
  const x = leg.startsWith('left') ? 0.15 : -0.15, fore = leg.endsWith('Fore');
  (fore ? [v(x, 0.95, 0.45), v(x, 0.6, 0.27), v(x, 0.22, 0.42), v(x, 0.06, 0.5)] : [v(x, 0.93, -0.5), v(x, 0.62, -0.27), v(x, 0.3, -0.68), v(x, 0.06, -0.56)])
    .forEach((at, k) => joints.push([`${leg}${k}`, k ? `${leg}${k - 1}` : fore ? 'trunk' : 'pelvis', at, 8 / (k + 1)]));
}
// each leg joint's range (°): sideways, fore and aft (+ its end back), twist — top, elbow or stifle, wrist or hock, paw
const RANGES: Record<string, number[][]> = { Fore: [[25, -90, 100, 20], [5, -110, 45, 5], [5, -10, 120, 5], [15, -70, 90, 10]],
  Hind: [[25, -80, 80, 20], [5, -40, 110, 5], [5, -110, 30, 5], [15, -70, 90, 10]] };
const deg = Math.PI / 180;
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

// footfalls (fore-left, fore-right, hind-left, hind-right): a lateral-sequence walk, a trot, a rotary gallop leading with the left fore —
// the right fore down first, then the left, the gathered flight, the left hind, the right hind, the extended flight [read: Hudson, Corr &
// Wilson 2012, J Exp Biol 215:2425, Fig. 2: a cheetah's and a greyhound's at 9–18 m/s]
const WALK = [0.25, 0.75, 0, 0.5], TROT = [0.5, 0, 0, 0.5], GALLOP = [0.65, 0.55, 0, 0.1];
// how it carries itself: trotting, bouncing on each diagonal (as the dog); galloping, once a stride, the withers lowest as the fores stand
// and the croup as the hinds do, the spine extended in the extended flight and flexed in the gathered one [recalled: Hildebrand 1959,
// the cheetah's flexing back; ±12° here, less than a cheetah's], the head held level [recalled: running felids and dogs hold the head
// steady as the trunk bounces], the tail swinging against the croup's pitch [recalled: the tail as a counterweight]
const TROTTING = { withers: -0.02, croup: [-0.02, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 1, headRise: 0, headWithers: 0.5 } as const;
const GALLOPING = { withers: -0.03, croup: [-0.03, Math.PI], spine: 12, spinePhase: 4.1, roll: 1, yaw: 1, headPitch: 0, headRise: 0, headWithers: 0.2, once: 1, tail: 0.8 } as const;

/**
 * The lion: it walks, trots from a Froude number of 0.6 and gallops from 3 (walk–trot ~0.5, trot–gallop 2–3 [recalled: Alexander &
 * Jayes 1983]; 4.7 m/s here against 5.4 m/s from Heglund, Taylor & McMahon 1974's 1.535 M^0.24 for 190 kg [recalled]), its gait's
 * stride and stance as `powerGait` scales them: at 14 m/s (a lion's 98th-percentile speed 13.9 m/s [snippet: Wilson et al. 2018, Nature
 * 554:183]) ~3 strides a second, each paw down a fifth of it [read: Hudson et al. 2012, a cheetah's 2.4–3.2 Hz at 9–17 m/s and duty
 * falling with speed], with two flights a stride. Galloping it runs lower on its legs (`run`), so they reach further fore and aft.
 */
export const LION: Species<'jaw'> = {
  skeleton,
  gaze: { neck: 'neck', eyes: (pose, out) => pose.point(skeleton.index('head'), v(0, -0.05, 0.2), out), range: { down: 0.4, up: 0.3, side: 0.5 } },
  hands: { jaw: 'mouth' },
  legs: {
    chains: legs.map((leg) => ({ joints: [0, 1, 2, 3].map((k) => ({ bone: skeleton.index(`${leg}${k}`), axes: ['yzx', 'x', 'x', 'zx'][k] })),
      heel: v(0, -0.06, -0.04), toe: v(0, -0.06, 0.08), toeOut: 0, rocker: [[0, 0], [1, 0]] })),
    gait: {
      ...powerGait({ height: 0.92, slowest: 0.6, offsets: footfalls([[0.3, WALK], [0.6, TROT], [2, TROT], [3, GALLOP]]), stride: 2.3, stance: 0.93, clearance: [0.06, 0.06, 0.06, 0.06] }),
      run: { froude: [1, 3], drop: 0.15 },
      body: carriages([[2, TROTTING], [3, GALLOPING]]),
    },
    carriage: { spine: 'spine', pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.4, period: 0.5, cycles: 3 },
      life: [['tail', { every: [3, 7], rate: 1, pick: swing }]] },
  },
};

/** the prey's lead on the lion as the chase starts (m), its pace then and once it breaks away (m/s) */
const PREY = { lead: 22, pace: 9, escape: 16 };

export function lionRun(): Scenario {
  return {
    id: 'lion-run', title: 'A lion runs down its prey', duration: 34, actors: [], cameraDistance: 4.5, cameraAngles: { side: Math.PI / 2 },
    description: 'A lion made of data only walks, trots and breaks into a full rotary gallop after its prey down a long field, then gives up the chase as it breaks away, slows and stops.',
    stage: (dev = false) => {
      // (the prey: off at its pace as the chase starts, breaking away once the lion is near; where it is at a time)
      let chase = Infinity, escape = Infinity, from = 0, stopped = false;
      const prey = (t: number) => v(0, 0.3, from + PREY.pace * Math.max(0, Math.min(t, escape) - chase) + PREY.escape * Math.max(0, t - escape));
      const pace = (t: number) => v(0, 0, t < chase ? 0 : t < escape ? PREY.pace : PREY.escape);
      const ahead = (lion: Body, m: number) => v(0, 0, lion.pose.position(0).z + m);
      const lion = new Body(LION, (lion) => function* () {
        const z = () => lion.pose.position(0).z, far = v(0, 0, 1e3);
        yield* walkTo(lion, { to: far, speed: 1.3, accel: 1.2, until: () => z() > 6 })();
        yield* walkTo(lion, { to: far, speed: 3.5, accel: 2, until: () => z() > 20 })();
        [chase, from] = [lion.frame.time, z() + PREY.lead];
        yield* walkTo(lion, { to: (f) => prey(f.time).setY(0), velocity: (f) => pace(f.time), speed: 14, accel: 3, until: (f) => prey(f.time).z - z() < 4 })();
        escape = lion.frame.time;
        // (it gives up: slows over as far as it takes to stop from its gallop, and stands)
        yield* walkTo(lion, { to: ahead(lion, 36), accel: 3, speed: 4 })();
        stopped = true;
      }, { dev });
      return {
        report: new Report(), bodies: [lion],
        props: (t) => [...skeletonProps(lion.pose, 0.03), { kind: 'ball', position: prey(t < chase ? chase : t), radius: 0.3 }],
        done: () => stopped,
        script: () => { throw new Error('the lion scenario has no humanoids'); },
      };
    },
  };
}
