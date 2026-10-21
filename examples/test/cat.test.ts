// A cat: the SKILL.md dog scaled by hand, k = 0.55 — every length × k, masses × k³, powerGait's height and clearance × k and its
// slowest pace × √k; its stride, stance, footfalls, ranges and carriage angles left as they are, being dimensionless. (DX test 3: with
// the stance in seconds, such a cat logged 39 touchdowns on its way to a bowl.) It must walk, and touch, as cleanly as the dog.
import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Body, named, powerGait, Skeleton, swing, touch, walkTo, type Species } from '@drawcall/animate';

function quadruped(k: number): Species<'jaw'> {
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z).multiplyScalar(k);
  const m = k ** 3;
  const joints: [string, string, Vector3, number][] = [['trunk', '', v(0, 0.46, 0), 15 * m], ['pelvis', 'trunk', v(0, 0.45, -0.16), 4 * m],
    ['neck', 'trunk', v(0, 0.44, 0.27), 2 * m], ['head', 'neck', v(0, 0.62, 0.45), 2.5 * m], ['jaw', 'head', v(0, 0.54, 0.67), 0.3 * m],
    ['tail', 'pelvis', v(0, 0.47, -0.32), 0.3 * m]];
  const legs = ['leftFore', 'rightFore', 'leftHind', 'rightHind'];
  for (const leg of legs) {
    const x = leg.startsWith('left') ? 0.08 : -0.08, fore = leg.endsWith('Fore'), z = fore ? 0.22 : -0.24, knee = fore ? -0.06 : 0.1;
    [v(x, 0.43, z), v(x, 0.28, z + knee), v(x, 0.1, z - knee / 2), v(x, 0.03, z)]
      .forEach((at, i) => joints.push([`${leg}${i}`, i ? `${leg}${i - 1}` : fore ? 'trunk' : 'pelvis', at, 1.5 * m / (i + 1)]));
  }
  const RANGES: Record<string, number[][]> = { Fore: [[25, -70, 70, 20], [5, -100, 30, 5], [5, -10, 110, 5], [15, -60, 90, 10]],
    Hind: [[25, -70, 70, 20], [5, -40, 100, 5], [5, -100, 30, 5], [15, -60, 90, 10]] };
  const at = (name: string) => joints.find(([n]) => n === name)![2], deg = Math.PI / 180;
  const skeleton = new Skeleton(joints.map(([name, parent, joint, mass]) => ({ name, parent: joints.findIndex(([n]) => n === parent), offset: parent ? joint.clone().sub(at(parent)) : joint, mass, com: new Vector3() })), {
    chains: { neck: ['neck', 'head'], mouth: ['neck', 'head', 'jaw'] },
    limits: joints.flatMap(([name], bone) => {
      const [, end, i] = /^(?:left|right)(Fore|Hind)(\d)$/.exec(name) ?? [];
      if (!end) return [];
      const [z, back, forth, twist] = RANGES[end][Number(i)];
      return [{ bone, axis: 1 as const, swing: [[-z * deg, z * deg], [back * deg, forth * deg]] as [[number, number], [number, number]], twist: [-twist * deg, twist * deg] as [number, number] }];
    }),
  });
  return {
    skeleton,
    gaze: { neck: 'neck', eyes: (pose, out) => pose.point(skeleton.index('head'), v(0, -0.02, 0.1), out), range: { down: 0.5, up: 0.4, side: 0.6 } },
    hands: { jaw: 'mouth' },
    legs: {
      chains: legs.map((leg) => ({ joints: [0, 1, 2, 3].map((i) => ({ bone: skeleton.index(`${leg}${i}`), axes: ['yzx', 'x', 'x', 'zx'][i] })),
        heel: v(0, -0.03, -0.02), toe: v(0, -0.03, 0.04), toeOut: 0, rocker: [[0, 0], [1, 0]] as [number, number][] })),
      gait: {
        ...powerGait({ height: 0.44 * k, slowest: 0.3 * Math.sqrt(k), offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: 0.93, clearance: [0.03, 0.03, 0.03, 0.03].map((c) => c * k) }),
        body: { withers: -0.012 * k, croup: [-0.012 * k, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 2, headRise: 0, headWithers: 1 },
      },
      carriage: { pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.6, period: 0.35, cycles: 6 },
        life: [['tail', { every: [2, 5], rate: 1, pick: swing }]] },
    },
  };
}


/** scenario 4: the cat at the origin facing +Z touches a bowl with its jaw; 60 fps up to 30 s */
function bowl(k: number) {
  const target = new Vector3(0.8, 0.04, 1.5);
  const cat = new Body(quadruped(k), (c) => function* () {
    yield* named('to the bowl', touch(c, 'jaw', target))();
  }, { dev: true });
  let closest = Infinity, finished: number | null = null;
  for (let t = 0; t < 30 && finished === null; ) {
    cat.update(1 / 60);
    t += 1 / 60;
    closest = Math.min(closest, cat.pose.position(cat.hands.jaw).distanceTo(target));
    if (cat.done) finished = t;
  }
  return { cat, finished, closest };
}

describe('a cat: the SKILL dog scaled by hand to 0.55', () => {
  test('k = 0.55: touches the bowl', () => {
    const r = bowl(0.55);
    expect(r.finished).not.toBeNull();
    expect(r.closest).toBeLessThan(0.01);
    expect(r.cat.log).toEqual([]);
  });
  test('k = 1 (the SKILL dog): clean', () => {
    const r = bowl(1);
    expect(r.finished).not.toBeNull();
    expect(r.cat.log).toEqual([]);
  });
  test('k = 0.55: a plain 2 m walk', () => {
    const cat = new Body(quadruped(0.55), (c) => walkTo(c, { to: new Vector3(0, 0, 2) }), { dev: true });
    for (let t = 0; t < 30 && !cat.done; t += 1 / 60) cat.update(1 / 60);
    expect(cat.done).toBe(true);
    expect(cat.log).toEqual([]);
  });
});
