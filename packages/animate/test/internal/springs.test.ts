import { Quaternion, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Body } from '../../src/index';
import { species, type Spring } from '../../src/species';
import { Binding } from '../../src/body/binding';
import { Springs } from '../../src/body/springs';

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

