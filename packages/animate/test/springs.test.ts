import { Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Body, humanoid } from '../src/index';
import { species, type Spring } from '../src/species';
import { Binding } from '../src/body/binding';
import { Springs } from '../src/body/springs';
import { PERSON } from '../skills/animate/references/person';

const CHAIN = [
  { name: 'root', position: [0, 1, 0] },
  { name: 'braid', parent: 'root', position: [0, 1, 0] },
  { name: 'middle', parent: 'braid', position: [0, 0.8, 0] },
  { name: 'tip', parent: 'middle', position: [0, 0.6, 0] },
] as const;

function chain(settings: Spring = {}) {
  const kind = species(CHAIN, {}, { masses: { root: 1 }, springs: { braid: settings } });
  const binding = new Binding(kind), springs = new Springs(kind, binding, null);
  const step = () => { springs.restore(); springs.step(1 / 60); };
  return { binding, springs, step, bones: binding.bones };
}

const position = (node: { getWorldPosition(out: Vector3): Vector3 }) => node.getWorldPosition(new Vector3());

test('a hanging chain stays at rest, then lags a moving root and settles without stretching', () => {
  const { bones, step } = chain();
  for (let i = 0; i < 60; i++) step();
  expect(position(bones.tip).distanceTo(new Vector3(0, 0.6, 0))).toBeLessThan(1e-10);
  bones.root.position.x = 0.12;
  step();
  expect(position(bones.tip).x).toBeLessThan(0.06);
  let swing = 0;
  for (let i = 0; i < 600; i++) {
    step();
    expect(position(bones.braid).distanceTo(position(bones.middle))).toBeCloseTo(0.2, 10);
    expect(position(bones.middle).distanceTo(position(bones.tip))).toBeCloseTo(0.2, 10);
    swing = Math.max(swing, Math.abs(position(bones.tip).x - 0.12));
  }
  expect(swing).toBeGreaterThan(0.02);
  expect(position(bones.tip).x).toBeCloseTo(0.12, 5);
});

test('a hang turns the root in place of the pose written over it, and the chain hangs from there under gravity', () => {
  const ahead = (settings: Spring) => {
    const { bones, springs } = chain(settings);
    for (let i = 0; i < 600; i++) {
      springs.restore();
      bones.braid.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.3); // as an animation writes it, every step
      springs.step(1 / 60);
    }
    return position(bones.tip).sub(position(bones.braid));
  };
  expect(ahead({ hang: [-Math.PI / 2, 0, 0], gravity: [0, 0, 0] }).normalize().z).toBeCloseTo(1, 6);
  // (and on a root with several chains, which no link turns, as a body renders it)
  const tufted = species([...CHAIN, { name: 'lock', parent: 'braid', position: [0.1, 0.9, 0] }, { name: 'lockTip', parent: 'lock', position: [0.1, 0.7, 0] }] as const,
    {}, { masses: { root: 1 }, springs: { braid: { hang: [Math.PI / 2, 0, 0] } } });
  const tuft = new Body(tufted);
  tuft.update(1 / 30);
  expect(tuft.bones.braid.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))).toBeLessThan(1e-9);
  // (held out ahead, the chain sags: below the hang's line, short of straight down)
  const sagging = ahead({ hang: [-Math.PI / 2, 0, 0] });
  expect(sagging.z).toBeGreaterThan(0.1);
  expect(sagging.y).toBeLessThan(-0.1);
});

test('gravity bends a horizontal chain, very stiff settings stay finite, and none settles', () => {
  for (const stiffness of [0, 40, 1e7]) {
    const { bones, step } = chain({ stiffness });
    bones.root.rotation.z = Math.PI / 2;
    for (let i = 0; i < 300; i++) step();
    expect(position(bones.tip).toArray().every(Number.isFinite)).toBe(true);
    if (stiffness < 100) expect(position(bones.tip).y).toBeLessThan(0.9);
  }
  // (damped against gravity's pull as well as its stiffness: a chain of none, knocked aside, settles in two seconds too)
  const { bones, step } = chain({ stiffness: 0 });
  bones.root.position.x = 0.12;
  for (let i = 0; i < 120; i++) step();
  expect(Math.abs(position(bones.tip).x - 0.12)).toBeLessThan(1e-3);
});

test('damping is relative to the joint, so steady translation does not drag a braid sideways', () => {
  const { bones, step } = chain();
  for (let i = 0; i < 600; i++) { bones.root.position.x += 2 / 60; step(); }
  const relative = position(bones.tip).sub(position(bones.braid));
  expect(Math.abs(relative.x)).toBeLessThan(0.01);
  expect(relative.y).toBeCloseTo(-0.4, 3);
});

test('branch joints keep their pose while each child chain swings', () => {
  const skeleton = [...CHAIN,
    { name: 'lock', parent: 'braid', position: [0.1, 0.9, 0] },
    { name: 'lockTip', parent: 'lock', position: [0.1, 0.7, 0] },
  ] as const;
  const kind = species(skeleton, {}, { masses: { root: 1 }, springs: { braid: {} } });
  const binding = new Binding(kind), springs = new Springs(kind, binding, null);
  binding.bones.root.position.x = 0.15;
  for (let i = 0; i < 3; i++) { springs.restore(); springs.step(1 / 60); }
  expect(binding.bones.braid.quaternion.angleTo(new Quaternion())).toBe(0);
  expect(binding.bones.middle.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.01);
  expect(binding.bones.lock.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.01);
});

test('invalid roots, overlap, zero lengths and invalid parameters fail at construction', () => {
  const make = (springs: Record<string, Spring>) => new Body({ ...species(CHAIN, {}, { masses: { root: 1 } }), springs });
  expect(() => make({ missing: {} })).toThrow(/no bone "missing"/);
  expect(() => make({ tip: {} })).toThrow(/no bone with one child/);
  expect(() => make({ braid: {}, middle: {} })).toThrow(/overlapping/);
  expect(() => make({ braid: { stiffness: -1 } })).toThrow(/stiffness/);
  expect(() => make({ braid: { damping: NaN } })).toThrow(/damping/);
  expect(() => make({ braid: { gravity: [0, Infinity, 0] } })).toThrow(/gravity/);
  const knotted = species([...CHAIN, { name: 'knot', parent: 'tip', position: [0, 0.6, 0] }] as const, {}, { masses: { root: 1 } });
  expect(() => new Body({ ...knotted, springs: { middle: {} } })).toThrow(/no length/);
  expect(() => new Body({ ...humanoid(PERSON), springs: { leftLowerArm: {} } })).toThrow(/posed by the body/);
  expect(() => new Body({ ...species(CHAIN, { hands: { jaw: ['braid', 'middle'] } }, { masses: { root: 1 } }), springs: { braid: {} } })).toThrow(/posed by the body/);
});

const BRAIDED = [...PERSON,
  { name: 'braid', parent: 'head', position: [0, 1.65, -0.15] },
  { name: 'braidMiddle', parent: 'braid', position: [0, 1.4, -0.15] },
  { name: 'braidTip', parent: 'braidMiddle', position: [0, 1.15, -0.15] },
] as const;

test('a person\'s braid keeps out of its body when it stops hard, behind it and not round its flank', () => {
  const kind = { ...humanoid(BRAIDED), springs: { braid: { stiffness: 10, damping: 0.3 } } };
  // (6 m/s along +Z, weaving, stopped in a quarter of a second: the braid swings forward over the shoulders and round the sides)
  const speed = (time: number) => time < 1 ? 6 : Math.max(0, 6 - 25 * (time - 1));
  const at = (time: number) => time < 1 ? 6 * time : 6 + (6 * 6 - speed(time) ** 2) / 50;
  const body = new Body(kind, {
    life: { seed: 7 },
    drive: time => ({ position: new Vector3(0.3 * Math.sin(3 * time), 0, at(time)), velocity: new Vector3(0.9 * Math.cos(3 * time), 0, speed(time)), yaw: 0.6 * Math.sin(3 * time), support: new Vector3() }),
  });
  if (!kind.person) throw new Error('a humanoid is a person');
  const radius = 0.06 * kind.person.height, bones = body.bones;
  let deepest = -Infinity, ahead = -Infinity;
  for (let i = 0; i < 180; i++) {
    body.update(1 / 60);
    const hips = position(bones.hips), neck = position(bones.neck), chest = position(bones.chest), axis = neck.clone().sub(hips);
    const left = position(bones.leftUpperLeg).sub(position(bones.rightUpperLeg)).setY(0).normalize(), forward = new Vector3(-left.z, 0, left.x);
    for (const [from, to] of [[bones.braid, bones.braidMiddle], [bones.braidMiddle, bones.braidTip]]) {
      // (along each link, not only at its ends)
      for (let k = 0; k <= 10; k++) {
        const p = position(from).lerp(position(to), k / 10), along = Math.min(1, Math.max(0, p.clone().sub(hips).dot(axis) / axis.lengthSq()));
        deepest = Math.max(deepest, radius - p.distanceTo(hips.clone().addScaledVector(axis, along)));
        const off = p.clone().sub(chest);
        if (p.y > hips.y && p.y < neck.y && Math.abs(off.dot(left)) < 0.15) ahead = Math.max(ahead, off.dot(forward));
      }
    }
  }
  expect(deepest).toBeLessThan(1e-3);
  expect(ahead).toBeLessThan(0);
  // (hair rooted at the nape, inside that capsule, swings free of it: it hangs where it hung)
  const napeKind = { ...humanoid([...PERSON,
    { name: 'nape', parent: 'head', position: [0, 1.52, -0.07] },
    { name: 'napeMiddle', parent: 'nape', position: [0, 1.44, -0.07] },
    { name: 'napeTip', parent: 'napeMiddle', position: [0, 1.36, -0.07] },
  ] as const), springs: { nape: {} } };
  const nape = new Body(napeKind, { life: { seed: 7 } });
  nape.update(1 / 60);
  const hung = position(nape.bones.napeTip).sub(position(nape.bones.nape));
  for (let i = 0; i < 60; i++) nape.update(1 / 60);
  expect(position(nape.bones.napeTip).sub(position(nape.bones.nape)).distanceTo(hung)).toBeLessThan(2e-3);
});

test('body springs use fixed steps and separate state for each instance', () => {
  const skeleton = BRAIDED;
  const kind = { ...humanoid(skeleton), springs: { braid: { stiffness: 24, damping: 0.6 } } };
  const bodies = [30, 60, 120].map(fps => {
    const body = new Body(kind, {
      life: { seed: 7 },
      drive: time => ({ position: new Vector3(time < 1 ? time : 1, 0, 0), velocity: new Vector3(time < 1 ? 1 : 0, 0, 0), yaw: 0, support: new Vector3() }),
    });
    for (let i = 0; i < fps * 2; i++) body.update(1 / fps);
    return body;
  });
  const first = position(bodies[0].bones.braidTip);
  for (const body of bodies.slice(1)) expect(position(body.bones.braidTip).distanceTo(first)).toBeLessThan(1e-9);
  const last = bodies[0].bones.braid.quaternion.clone();
  bodies[0].update(0);
  expect(bodies[0].bones.braid.quaternion.angleTo(last)).toBeLessThan(1e-7);
  const still = new Body(kind, { life: { seed: 7 } });
  const before = still.bones.braid.quaternion.clone();
  bodies[0].update(0.1);
  expect(still.bones.braid.quaternion.equals(before)).toBe(true);
});
