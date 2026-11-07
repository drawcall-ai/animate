import { Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Body, humanoid, species, type Spring } from '../src/index';
import { Binding } from '../src/body/model';
import { Springs } from '../src/springs';
import { PERSON } from '../skills/animate/references/person';

const CHAIN = [
  { name: 'root', position: [0, 1, 0] },
  { name: 'braid', parent: 'root', position: [0, 1, 0] },
  { name: 'middle', parent: 'braid', position: [0, 0.8, 0] },
  { name: 'tip', parent: 'middle', position: [0, 0.6, 0] },
] as const;

function chain(settings: Spring = {}) {
  const kind = species(CHAIN, {}, { masses: { root: 1 }, springs: { braid: settings } });
  const binding = new Binding(kind), springs = new Springs(kind, binding);
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

test('a rest turn replaces the root\'s rotation in the model', () => {
  const { bones, step } = chain({ rest: [Math.PI, 0, 0], gravity: [0, 0, 0] });
  for (let i = 0; i < 60; i++) step();
  expect(position(bones.tip).distanceTo(new Vector3(0, 1.4, 0))).toBeLessThan(1e-6);
});

test('gravity bends a horizontal chain, and very stiff settings stay finite', () => {
  for (const stiffness of [0, 40, 1e7]) {
    const { bones, step } = chain({ stiffness });
    bones.root.rotation.z = Math.PI / 2;
    for (let i = 0; i < 300; i++) step();
    expect(position(bones.tip).toArray().every(Number.isFinite)).toBe(true);
    if (stiffness < 100) expect(position(bones.tip).y).toBeLessThan(0.9);
  }
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
  const binding = new Binding(kind), springs = new Springs(kind, binding);
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
  expect(() => make({ root: {} })).toThrow(/no length/);
});

test('body springs use fixed steps and separate state for each instance', () => {
  const skeleton = [...PERSON,
    { name: 'braid', parent: 'head', position: [0, 1.65, -0.15] },
    { name: 'braidMiddle', parent: 'braid', position: [0, 1.4, -0.15] },
    { name: 'braidTip', parent: 'braidMiddle', position: [0, 1.15, -0.15] },
  ] as const;
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
