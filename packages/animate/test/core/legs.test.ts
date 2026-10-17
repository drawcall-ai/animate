import { expect, it, vi } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { Body, type Frame } from '../../src/core/body';
import { strideAt } from '../../src/core/legs/gait';
import { Limb, type Walker } from '../../src/core/legs/limb';
import { Solver } from '../../src/core/legs/solve';
import * as pursuit from '../../src/core/legs/root';
import { Legs } from '../../src/core/legs/legs';
import { quintic } from '../../src/core/legs/swing';
import { HORSE_WALK, horseLegs, horseCarriage, horsePelvis } from '../../src/horse/legs';
import { SKELETON, LEGS, HEAD } from '../../src/horse/skeleton';
import { Pose } from '../../src/core/pose';

it('a Cartesian swing has a bell-shaped speed peaking halfway and zero contact acceleration', () => {
  for (const T of [0.08, 0.2, 0.6]) {
    const values = Array.from({ length: 201 }, (_, k) => quintic(0, 0, 0, 1, 0, T, T * k / 200));
    expect(values[0]).toEqual([0, 0, 0]);
    expect(values[200]).toEqual([1, 0, 0]);
    for (const [x] of values) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
    expect(values.findIndex((v) => v[1] === Math.max(...values.map((x) => x[1])))).toBe(100);
    expect(values[100][1]).toBeCloseTo(1.875 / T, 8);
  }
});

it('a swing ends on the stance rate rather than at rest', () => {
  const end = quintic(0, 0.2, 0, 1, -0.7, 0.5, 0.5 - 1e-6);
  expect(end[0]).toBeCloseTo(1, 5);
  expect(end[1]).toBeCloseTo(-0.7, 5);
  expect(end[2]).toBeCloseTo(0, 2);
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

it('checks touchdown on direct Legs users after later pose writers, only with dev enabled', () => {
  const run = (dev: boolean) => {
    const pose = new Pose(SKELETON);
    const engine = new Legs(pose, horseLegs(), HORSE_WALK);
    let landed = -1;
    const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
      engine.toward(f, { position: new Vector3(0, pose.position(0).y, 20) }, { speed: 0.95, accel: 0.65 });
      if (landed < 0 && engine.events.some((event) => event.type === 'land')) {
        landed = f.time;
        f.current.setRoot(f.current.position(0).clone().add(new Vector3(0.01, 0, 0)));
      }
    } }), { pose, dev });
    for (let tick = 0; tick < 120 && (landed < 0 || body.frame.time <= landed); tick++) body.update(1 / 60);
    expect(landed).toBeGreaterThan(0);
    return { log: body.log.filter((entry) => entry.check === 'leg touchdown speed (m/s)'), landed };
  };
  const { log, landed } = run(true);
  expect(log).toContainEqual(expect.objectContaining({ limit: 0.1, time: landed }));
  expect(run(false).log).toEqual([]);
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
  const walker: Walker = { phase: 0, timeTo: () => 0, at: () => strideAt(HORSE_WALK, 1.6, 0), stride: strideAt(HORSE_WALK, 1.6, 0), rootAt: (_, position, turn) => {
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
    horsePelvis(f, engine);
    engine.toward(f, { position: new Vector3(0, 1.37, 20) }, { speed: 0.95, accel: 0.65 });
    horseCarriage(f, engine);
  } }), { pose, dev: true });
  const support: number[] = [], swing: number[] = [], poll: number[] = [];
  const hoofPitch: number[] = [], hindHock: number[] = [], column: number[] = [];
  const planted = [true, true, true, true];
  const contact = [0, 0];
  for (let tick = 0; tick < 480; tick++) {
    body.update(1 / 60);
    engine.legs.forEach((state, i) => {
      if (state.planted && !planted[i]) {
        const speed = body.pose.position(LEGS[i].hoof).distanceTo(body.frame.prev2.position(LEGS[i].hoof)) * 60;
        contact[i < 2 ? 0 : 1] = Math.max(contact[i < 2 ? 0 : 1], speed);
      }
      planted[i] = state.planted;
    });
    if (tick < 180) continue;
    const state = engine.legs[0];
    const q = body.pose.local(LEGS[0].cannon);
    const angle = Math.abs(2 * Math.atan2(q.x, q.w)) * 180 / Math.PI;
    if (state.planted && state.phase > 0.15 && state.phase < 0.45) support.push(angle);
    if (!state.planted) swing.push(angle);
    poll.push(body.pose.position(HEAD).y);
    engine.legs.forEach((leg, i) => {
      if (!leg.planted) {
        const forward = new Vector3(0, 0, 1).applyQuaternion(body.pose.rotation(LEGS[i].hoof));
        hoofPitch.push(Math.asin(forward.y) * 180 / Math.PI);
      }
      if (i < 2 && leg.planted && leg.phase > 0.26 && leg.phase < 0.3) {
        const delta = body.pose.position(LEGS[i].pastern).clone().sub(body.pose.position(LEGS[i].cannon));
        column.push(Math.abs(Math.atan2(delta.z, -delta.y)) * 180 / Math.PI);
      }
      if (i >= 2 && leg.planted && leg.phase > 0.2 && leg.phase < 0.45) {
        const hock = body.pose.local(LEGS[i].cannon);
        hindHock.push(Math.abs(2 * Math.atan2(hock.x, hock.w)) * 180 / Math.PI);
      }
    });
  }
  expect(Math.max(...contact)).toBeLessThanOrEqual(0.1);
  expect(support.length).toBeGreaterThan(30);
  expect(Math.max(...support)).toBeLessThan(3);
  expect(Math.max(...swing)).toBeGreaterThan(25);
  expect(Math.max(...poll) - Math.min(...poll)).toBeGreaterThan(0.12);
  expect(hoofPitch.length).toBeGreaterThan(30);
  expect(Math.min(...hoofPitch)).toBeGreaterThan(-25);
  expect(Math.max(...hindHock)).toBeLessThan(6);
  expect(column.length).toBeGreaterThan(5);
  expect(Math.max(...column)).toBeLessThan(3);
  expect(body.log).toEqual([]);
});

it.each([[0.4, 0], [0.2, -1], [0, -2], [1, 2], [-1, 2]])('supports ordinary goals (%s, %s), then follows their next position', (x, z) => {
  const pose = new Pose(SKELETON);
  const engine = new Legs(pose, horseLegs(), HORSE_WALK);
  const goal = new Vector3(x, pose.position(0).y, z);
  const start = pose.position(0).clone();
  const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
    engine.toward(f, { position: goal }, { speed: 0.95, accel: 0.65 });
  } }), { pose, dev: true });
  for (let tick = 0; tick < 120; tick++) body.update(1 / 60);
  if (z <= 0) expect(body.pose.position(0).clone().setY(start.y).distanceTo(start)).toBeLessThan(1e-6);
  goal.set(0, start.y, 3);
  for (let tick = 0; tick < 240; tick++) body.update(1 / 60);
  expect(body.pose.position(0).z).toBeGreaterThan(1);
  expect(body.log).toEqual([]);
});

it('brakes for a moving goal that crosses behind a travelling root', () => {
  const pose = new Pose(SKELETON);
  const engine = new Legs(pose, horseLegs(), HORSE_WALK);
  const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
    const goal = f.time < 2 ? new Vector3(0, 0, 5) : new Vector3(0.1 * Math.sin(f.time), 0, -2);
    engine.toward(f, { position: goal }, { speed: 0.95, accel: 0.65 });
  } }), { pose, dev: true });
  for (let tick = 0; tick < 480; tick++) body.update(1 / 60);
  expect(body.pose.position(0).z).toBeGreaterThan(0.5);
  expect(body.pose.position(0).z).toBeLessThan(3);
  expect(body.log).toEqual([]);
});

it('rejects invalid follower goals and motion instead of waiting', () => {
  for (const [position, motion] of [
    [new Vector3(NaN, 0, 1), { accel: 1 }],
    [new Vector3(0, 0, 1), { accel: 0 }],
    [new Vector3(0, 0, 1), { accel: 1, speed: -1 }],
    [new Vector3(0, 0, 1), { accel: 1, turnAccel: NaN }],
  ] as const) {
    const pose = new Pose(SKELETON);
    const engine = new Legs(pose, horseLegs(), HORSE_WALK);
    const body = new Body(SKELETON, () => action<Frame>({ update: (f) => engine.toward(f, { position }, motion) }), { pose });
    expect(() => body.update(1 / 60)).toThrow(/root (goal|motion|turn motion)/);
  }
});

it('reuses each travel forecast across root-height candidates', () => {
  const pose = new Pose(SKELETON);
  const engine = new Legs(pose, horseLegs(), HORSE_WALK);
  const goal = new Vector3(1, pose.position(0).y, 2);
  const body = new Body(SKELETON, () => action<Frame>({ update: (f) => {
    engine.toward(f, { position: goal }, { speed: 0.95, accel: 0.65 });
  } }), { pose, dev: true });
  const forecast = vi.spyOn(pursuit, 'rootPlan');
  try {
    for (let tick = 0; tick < 120; tick++) {
      forecast.mockClear();
      body.update(1 / 60);
      const shares = forecast.mock.calls.map((args) => args[6]);
      expect(shares.length).toBeGreaterThan(0);
      expect(shares.length).toBe(new Set(shares).size);
    }
  } finally { forecast.mockRestore(); }
});
