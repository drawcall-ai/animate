import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action } from '@pmndrs/timeline';
import { Body, brake, chainTo, lookAt, Skeleton, type BoneDef, type Frame } from '../../src';
import { spinOf } from '../../src/core/rotation';
import { leg, turn } from './rigs';

const dt = 1 / 60;

describe('chainTo', () => {
  it("moves a chain's tip on to its target, its joints braked to `turnAccel`, and ends there once reached", () => {
    const goal = new Vector3(0.25, 0.35, 0.3);
    let ended = -1;
    const body = new Body(leg(), function* () {
      yield* chainTo('leg', { position: goal }, { accel: 6, speed: 1, turnAccel: 40, pole: new Vector3(0.1, 0.6, 2), until: 'reached' })();
      yield* action<Frame>({ init: () => void (ended = body.frame.time), update: () => false });
    });
    const knee: Quaternion[] = [];
    for (let k = 0; k < 240 && ended < 0; k++) {
      body.update(dt);
      knee.push(body.pose.local(2).clone());
    }
    expect(ended).toBeGreaterThan(0);
    expect(body.pose.position(3).distanceTo(goal)).toBeLessThan(0.01);
    const spins = knee.slice(1).map((q, k) => spinOf(knee[k], q, dt, new Vector3()));
    expect(Math.max(...spins.slice(1).map((w, k) => w.distanceTo(spins[k]) / dt))).toBeLessThan(40 + 1e-6);
  });
});

describe('brake', () => {
  it("holds a joint to its acceleration where its goal jumps, and follows a goal moving smoothly without lag", () => {
    const goals = new Map<number, Quaternion>();
    let goal = (t: number) => turn(1, 0, 0, Math.sin(2 * t));
    const body = new Body(leg(), function* () {
      yield* action<Frame>({
        update: (f) => {
          f.current.setLocal(2, goal(f.time));
          brake(f, [2], { accel: 30, speed: 8 }, goals);
        },
      });
    });
    for (let k = 0; k < 120; k++) body.update(dt);
    expect(body.pose.local(2).angleTo(goal(body.frame.time))).toBeLessThan(1e-3);
    goal = () => turn(1, 0, 0, 2);
    const turns: number[] = [];
    let last = body.pose.local(2).clone();
    for (let k = 0; k < 30; k++) {
      body.update(dt);
      turns.push(body.pose.local(2).angleTo(last) / dt);
      last = body.pose.local(2).clone();
    }
    expect(Math.max(...turns.slice(1).map((w, k) => Math.abs(w - turns[k]) / dt))).toBeLessThan(30 + 1);
  });
});

describe('lookAt', () => {
  it("turns a gazer's head, upright, until its eyes are on the point", () => {
    const bone = (name: string, parent: number, y: number): BoneDef => ({ name, parent, offset: new Vector3(0, y, 0), mass: 1, com: new Vector3() });
    const skeleton = new Skeleton([bone('chest', -1, 1.4), bone('neck', 0, 0.1), bone('head', 1, 0.1)], { chains: { neck: ['neck', 'head'] } });
    const gazer = { neck: 'neck', eyes: (pose: Frame['prev'], out: Vector3) => pose.point(2, new Vector3(0, 0.05, 0.08), out) };
    const point = new Vector3(2, 1.2, 1);
    const body = new Body(skeleton, lookAt(gazer, point));
    for (let k = 0; k < 120; k++) body.update(dt);
    const head = body.pose.rotation(2);
    const forward = new Vector3(0, 0, 1).applyQuaternion(head);
    const eyes = gazer.eyes(body.pose, new Vector3());
    expect(forward.angleTo(point.clone().sub(eyes))).toBeLessThan(0.02);
    expect(new Vector3(1, 0, 0).applyQuaternion(head).y).toBeCloseTo(0, 6);
  });
});
