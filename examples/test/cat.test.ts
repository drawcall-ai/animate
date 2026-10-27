// A cat: a dog of the SKILL's kind scaled by hand, k = 0.55 — every length × k, masses × k³, powerGait's height and clearance × k and its
// slowest pace × √k; its stride, stance, footfalls, ranges and carriage angles left as they are, being dimensionless. It must walk, and
// touch, as cleanly as the dog.
import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import type { SkeletonBone } from '@drawcall/rig';
import { Body, reach, species, walkTo } from '@drawcall/animate';
import { powerGait, swing, type Range } from '@drawcall/animate/species';
import { play } from '../../packages/animate/test/bodies';

const LEGS = ['leftFore', 'rightFore', 'leftHind', 'rightHind'] as const;
const JOINTS = [0, 1, 2, 3] as const;
type Bone = 'trunk' | 'pelvis' | 'neck' | 'head' | 'jaw' | 'tail' | `${(typeof LEGS)[number]}${(typeof JOINTS)[number]}`;
const DEG = Math.PI / 180;
// each leg joint's range (°): sideways, fore and aft (+ its end back), twist — top, elbow or stifle, carpus or hock, paw
const RANGES = { Fore: [[25, -70, 70, 20], [5, -100, 30, 5], [5, -10, 110, 5], [15, -60, 90, 10]],
  Hind: [[25, -70, 70, 20], [5, -40, 100, 5], [5, -100, 30, 5], [15, -60, 90, 10]] } as const;

/** the four-legged body at `k` times its size */
function quadruped(k: number) {
  const at = (x: number, y: number, z: number) => [x * k, y * k, z * k] as const;
  const skeleton: SkeletonBone<Bone>[] = [{ name: 'trunk', position: at(0, 0.46, 0) }, { name: 'pelvis', parent: 'trunk', position: at(0, 0.45, -0.16) },
    { name: 'neck', parent: 'trunk', position: at(0, 0.44, 0.27) }, { name: 'head', parent: 'neck', position: at(0, 0.62, 0.45) },
    { name: 'jaw', parent: 'head', position: at(0, 0.54, 0.67) }, { name: 'tail', parent: 'pelvis', position: at(0, 0.47, -0.32) }];
  const masses: Partial<Record<Bone, number>> = { trunk: 15 * k ** 3, pelvis: 4 * k ** 3, neck: 2 * k ** 3, head: 2.5 * k ** 3, jaw: 0.3 * k ** 3, tail: 0.3 * k ** 3 };
  const limits: Partial<Record<Bone, Range>> = {};
  for (const leg of LEGS) {
    const side = leg.startsWith('left') ? 0.08 : -0.08, fore = leg.endsWith('Fore'), z = fore ? 0.22 : -0.24, knee = fore ? -0.06 : 0.1;
    const joints = [at(side, 0.43, z), at(side, 0.28, z + knee), at(side, 0.1, z - knee / 2), at(side, 0.03, z)];
    for (const joint of JOINTS) {
      skeleton.push({ name: `${leg}${joint}`, parent: joint ? `${leg}${(joint - 1) as 0 | 1 | 2}` : fore ? 'trunk' : 'pelvis', position: joints[joint] });
      masses[`${leg}${joint}`] = 1.5 * k ** 3 / (joint + 1);
      const [sideways, back, forth, twist] = RANGES[fore ? 'Fore' : 'Hind'][joint];
      limits[`${leg}${joint}`] = { axis: 1, swing: [[-sideways * DEG, sideways * DEG], [back * DEG, forth * DEG]], twist: [-twist * DEG, twist * DEG] };
    }
  }
  return species(skeleton, {
    gaze: { neck: ['neck', 'head'], eyes: { bone: 'head', at: at(0, -0.02, 0.1) }, range: { down: 0.5, up: 0.4, side: 0.6 } },
    hands: { jaw: ['neck', 'head', 'jaw'] },
    legs: LEGS.map((leg) => ({ joints: JOINTS.map((joint) => ({ bone: `${leg}${joint}` as const, axes: ['yzx', 'x', 'x', 'zx'][joint] })), heel: at(0, -0.03, -0.02), toe: at(0, -0.03, 0.04) })),
    carriage: { pelvis: 'pelvis', neck: 'neck', head: 'head', tail: 'tail', swish: { amplitude: 0.6, period: 0.35, cycles: 6 },
      life: [['tail', { every: [2, 5], rate: 1, pick: swing }]] },
  }, {
    gait: {
      ...powerGait({ height: 0.44 * k, slowest: 0.3 * Math.sqrt(k), offsets: [0.52, 0.02, 0, 0.5], stride: 2.15, stance: 0.93, clearance: [0.03, 0.03, 0.03, 0.03].map((lift) => lift * k) }),
      body: { withers: -0.012 * k, croup: [-0.012 * k, 0], spine: 0, spinePhase: 0, roll: 2, yaw: 1, headPitch: 2, headRise: 0, headWithers: 1 },
    },
    masses,
    limits,
  });
}

/** the cat at the origin facing +Z touches a bowl with its jaw, up to 30 s: whether it got there, and how near its jaw came */
function bowl(k: number) {
  const target = new Vector3(0.8, 0.04, 1.5);
  const cat = new Body(quadruped(k), { dev: true }), jaw = cat.pose.skeleton.index('jaw');
  let closest = Infinity, touched = false;
  play(function* () { touched = yield* reach(cat, { jaw: target }); }, [cat], 30, () => {
    closest = Math.min(closest, cat.pose.position(jaw).distanceTo(target));
    return touched;
  });
  return { cat, touched, closest };
}

describe('a cat: a dog scaled by hand to 0.55', () => {
  test('k = 0.55: touches the bowl', () => {
    const { cat, touched, closest } = bowl(0.55);
    expect(touched).toBe(true);
    expect(closest).toBeLessThan(0.01);
    expect(cat.log).toEqual([]);
  });
  test('k = 1 (the dog): clean', () => {
    const { cat, touched } = bowl(1);
    expect(touched).toBe(true);
    expect(cat.log).toEqual([]);
  });
  test('k = 0.55: a plain 2 m walk', () => {
    const cat = new Body(quadruped(0.55), { dev: true });
    let walked = false;
    play(function* () { walked = yield* walkTo(cat, new Vector3(0, 0, 2)); }, [cat], 30, () => walked);
    expect(walked).toBe(true);
    expect(cat.log).toEqual([]);
  });
});
