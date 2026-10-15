import { expect, it, vi } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, type Frame } from '../../src/core/body';
import { strideAt } from '../../src/core/legs/gait';
import { Limb, type Motion } from '../../src/core/legs/limb';
import { Solver } from '../../src/core/legs/solve';
import { Legs } from '../../src/core/legs/legs';
import { boundSwing, quintic, type Swing } from '../../src/core/legs/swing';
import { HORSE_WALK, horseLegs, horseCarriage } from '../../src/horse/legs';
import { SKELETON, LEGS, HEAD } from '../../src/horse/skeleton';
import { Pose } from '../../src/core/pose';

it('a short swing with an outward lift-off derivative stays inside ROM and lands at rest', () => {
  for (const T of [0.08, 0.2, 0.6]) {
    for (const velocity of [-40, 40]) {
      const s: Swing = {
        x: new Float64Array([0.99]), v: new Float64Array([velocity]), a: new Float64Array([velocity * 100]),
        land: new Float64Array([-0.9]), stepping: 1, toes: new Quaternion(),
      };
      boundSwing(s, 0, T, -1, 1);
      for (let k = 0; k <= 200; k++) {
        const [q] = quintic(s.x[0], s.v[0], s.a[0], s.land[0], T, T * k / 200);
        expect(q).toBeGreaterThanOrEqual(-1 - 1e-12);
        expect(q).toBeLessThanOrEqual(1 + 1e-12);
      }
      expect(quintic(s.x[0], s.v[0], s.a[0], s.land[0], T, T)).toEqual([-0.9, 0, 0]);
    }
  }
});

it('leg contact checks read the final pose after a later writer, and disappear with dev off', () => {
  const run = (dev: boolean) => {
    const pose = new Pose(SKELETON);
    const engine = new Legs(pose, horseLegs(), HORSE_WALK);
    const root = { position: pose.position(0).clone(), quaternion: new Quaternion() };
    const joints = horseLegs()[0].joints;
    const terminal = joints[joints.length - 1].bone;
    const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
      engine.update(f, { root: () => root, speed: 0 });
      if (f.time > 0.05) {
        f.current.setLocal(terminal, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3));
        f.current.setRoot(root.position.clone().add(new Vector3(0.01, -0.01, 0)));
      }
    } }), { pose, dev });
    for (let k = 0; k < 10; k++) body.update(1 / 60);
    return body.log;
  };
  const checks = run(true).map((entry) => entry.check);
  expect(checks).toContain('leg contact (m)');
  expect(checks).toContain('leg contact turn (rad)');
  expect(checks).toContain('leg ground (m)');
  expect(run(false)).toEqual([]);
});

it('rounds tiny negative speed noise but rejects reverse and nonfinite speed', () => {
  expect(strideAt(HORSE_WALK, -8.9e-16, 0)).toEqual(strideAt(HORSE_WALK, 0, 0));
  for (const speed of [-1e-9, -0.1, NaN, Infinity]) expect(() => strideAt(HORSE_WALK, speed, 0)).toThrow('leg speed');
  const pose = new Pose(SKELETON);
  const engine = new Legs(pose, horseLegs(), HORSE_WALK);
  const root = { position: pose.position(0).clone(), quaternion: new Quaternion() };
  const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
    engine.update(f, { root: () => root, speed: () => -8.9e-16 });
  } }), { pose });
  for (let tick = 0; tick < 60; tick++) body.update(1 / 60);
});

it('shortens a long foothold with at most 40 reach solves and keeps its verified endpoint', () => {
  const pose = new Pose(SKELETON);
  pose.setRoot(new Vector3(0, 1.32, 0));
  const limb = new Limb(horseLegs()[0], pose);
  const root = pose.position(0).clone();
  const walker: Motion = { phase: 0, stride: strideAt(HORSE_WALK, 1.6, 0), rootAt: (_, position, turn) => {
    position.copy(root);
    turn.identity();
  } };
  const contact = limb.standing(pose);
  const standing = contact.position.clone();
  contact.position.z += 2;
  const reach = vi.spyOn(Solver.prototype, 'reach');
  try {
    limb.foothold(pose, walker, 0.4, contact);
    expect(reach.mock.calls.length).toBeLessThanOrEqual(40);
    expect(reach.mock.calls.length).toBeGreaterThan(8);
    expect(contact.position.z).toBeGreaterThanOrEqual(standing.z);
    expect(contact.position.z).toBeLessThan(standing.z + 2);
    expect(limb.landingSupported(pose, walker, 0.4, contact)).toBe(true);
  } finally {
    reach.mockRestore();
  }
});

it('follows a moving goal with supported contacts and a root that turns toward its path', () => {
  const pose = new Pose(SKELETON);
  const engine = new Legs(pose, horseLegs(), HORSE_WALK);
  let turned = 0;
  const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
    engine.toward(f, { position: new Vector3(0.05, pose.position(0).y, 2 + 0.75 * f.time), velocity: new Vector3(0, 0, 0.75) }, { speed: 0.95, accel: 0.65 });
    turned = Math.max(turned, Math.abs(2 * Math.atan2(f.current.rotation(0).y, f.current.rotation(0).w)));
  } }), { pose, dev: true });
  for (let tick = 0; tick < 8 * 60; tick++) body.update(1 / 60);
  expect(body.pose.position(0).z).toBeGreaterThan(4);
  expect(turned).toBeGreaterThan(0.01);
  expect(turned).toBeLessThan(0.2);
  expect(body.log).toEqual([]);
});

it('a slow horse walk supports on an extended carpus, folds in swing and visibly nods', () => {
  const pose = new Pose(SKELETON);
  pose.setRoot(new Vector3(0, 1.37, 0));
  const engine = new Legs(pose, horseLegs(), HORSE_WALK);
  const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
    engine.toward(f, { position: new Vector3(0, 1.37, 20) }, { speed: 0.95, accel: 0.65 });
    horseCarriage(f, engine);
  } }), { pose, dev: true });
  const support: number[] = [], swing: number[] = [], poll: number[] = [];
  for (let tick = 0; tick < 480; tick++) {
    body.update(1 / 60);
    if (tick < 180) continue;
    const state = engine.legs[0];
    const q = body.pose.local(LEGS[0].cannon);
    const angle = Math.abs(2 * Math.atan2(q.x, q.w)) * 180 / Math.PI;
    if (state.planted && state.phase > 0.15 && state.phase < 0.45) support.push(angle);
    if (!state.planted) swing.push(angle);
    poll.push(body.pose.position(HEAD).y);
  }
  expect(support.length).toBeGreaterThan(30);
  expect(Math.max(...support)).toBeLessThan(3);
  expect(Math.max(...swing)).toBeGreaterThan(25);
  expect(Math.max(...poll) - Math.min(...poll)).toBeGreaterThan(0.12);
  expect(body.log).toEqual([]);
});
