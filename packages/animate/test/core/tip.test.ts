import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { action, parallel } from '@pmndrs/timeline';
import { Body, chainTo, lookAt, SHIFT, Skeleton, TrackedRotation, type BoneDef, type Frame } from '../../src';
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

describe('TrackedRotation', () => {
  it('holds a joint to its acceleration where its goal jumps, and follows a goal moving smoothly without lag', () => {
    const joint = new TrackedRotation();
    let goal = (t: number) => turn(1, 0, 0, Math.sin(2 * t));
    const body = new Body(leg(), function* () {
      yield* action<Frame>({
        update: (f) => void f.current.setLocal(2, joint.follow(f.prev2.local(2), f.prev.local(2), goal(f.time), { accel: 30, speed: 8 }, f.dt, new Quaternion())),
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
  it("turns a gazer's head, upright, until its eyes are on the point: the head most of the way, the eyes the rest (a few degrees)", () => {
    const bone = (name: string, parent: number, y: number): BoneDef => ({ name, parent, offset: new Vector3(0, y, 0), mass: 1, com: new Vector3() });
    const skeleton = new Skeleton([bone('chest', -1, 1.4), bone('neck', 0, 0.1), bone('head', 1, 0.1)], { chains: { neck: ['neck', 'head'] } });
    const gazer = { neck: 'neck', eyes: (pose: Frame['prev'], out: Vector3) => pose.point(2, new Vector3(0, 0.05, 0.08), out), range: { down: 0.5, up: 0.35, side: 0.35 } };
    const point = new Vector3(2, 1.2, 1);
    const body = new Body(skeleton, lookAt(gazer, point));
    for (let k = 0; k < 120; k++) body.update(dt);
    const head = body.pose.rotation(2);
    const forward = new Vector3(0, 0, 1).applyQuaternion(head);
    const eyes = gazer.eyes(body.pose, new Vector3());
    // (the eyes take a quarter of the turn, at most 0.3 of their range to the side or up: 0.105 rad)
    const off = forward.angleTo(point.clone().sub(eyes));
    expect(off).toBeGreaterThan(0.08);
    expect(off).toBeLessThan(0.3 * 0.35 + 0.01);
    expect(new Vector3(1, 0, 0).applyQuaternion(head).y).toBeCloseTo(0, 6);
  });

  it('looks down past straight down at a point below and a little behind, rather than turning round', () => {
    const bone = (name: string, parent: number, y: number): BoneDef => ({ name, parent, offset: new Vector3(0, y, 0), mass: 1, com: new Vector3() });
    const skeleton = new Skeleton([bone('chest', -1, 1.4), bone('neck', 0, 0.1), bone('head', 1, 0.1)], { chains: { neck: ['neck', 'head'] } });
    const gazer = { neck: 'neck', eyes: (pose: Frame['prev'], out: Vector3) => pose.point(2, new Vector3(0, 0.05, 0.08), out), range: { down: 0.5, up: 0.35, side: 0.35 } };
    const point = new Vector3(0.05, 0, -0.3);
    const body = new Body(skeleton, lookAt(gazer, point));
    for (let k = 0; k < 120; k++) body.update(dt);
    // (still facing the way the chest does, not turned half round)
    expect(new Vector3(1, 0, 0).applyQuaternion(body.pose.rotation(2)).x).toBeGreaterThan(0.9);
  });

  it('keeps one way of looking at a point nearly straight below, the chest bowed and swaying under it', () => {
    const bone = (name: string, parent: number, y: number): BoneDef => ({ name, parent, offset: new Vector3(0, y, 0), mass: 1, com: new Vector3() });
    const skeleton = new Skeleton([bone('chest', -1, 1.4), bone('neck', 0, 0.1), bone('head', 1, 0.1)], { chains: { neck: ['neck', 'head'] } });
    const gazer = { neck: 'neck', eyes: (pose: Frame['prev'], out: Vector3) => pose.point(2, new Vector3(0, 0.05, 0.08), out), range: { down: 0.5, up: 0.35, side: 0.35 } };
    // (a hilt at the left hip, seen from above: down, a little left and ahead)
    const point = new Vector3(0.17, 0.95, 0.2);
    const sway = (t: number) => turn(0, 1, 0, 0.04 * Math.sin(2 * Math.PI * 3 * t)).multiply(turn(1, 0, 0, 0.4));
    const body = new Body(skeleton, function* () {
      yield* parallel<Frame>('all', function* () {
        yield* action<Frame>({ update: (f) => void f.current.setLocal(0, sway(f.time)) });
      }, lookAt(gazer, point));
    });
    const heads: Quaternion[] = [];
    let missed = 0;
    for (let k = 0; k < 120; k++) {
      body.update(dt);
      heads.push(body.pose.rotation(2).clone());
      const eyes = gazer.eyes(body.pose, new Vector3());
      if (k >= 60) missed = Math.max(missed, new Vector3(0, 0, 1).applyQuaternion(body.pose.rotation(2)).angleTo(point.clone().sub(eyes)));
    }
    // (on it but for the eyes' share, the head turning no faster than the chest sways under it: ~0.75 rad/s, 0.013 rad a step)
    expect(missed).toBeLessThan(0.3 * 0.35 + 0.03);
    expect(Math.max(...heads.slice(61).map((q, k) => q.angleTo(heads[60 + k])))).toBeLessThan(0.02);
  });

  it('turns the head as fast as the gaze shift is large (its main sequence), a bell, however many joints share the turn', () => {
    const bone = (name: string, parent: number, y: number): BoneDef => ({ name, parent, offset: new Vector3(0, y, 0), mass: 1, com: new Vector3() });
    const skeleton = new Skeleton([bone('chest', -1, 1.4), bone('neck', 0, 0.1), bone('head', 1, 0.1)], { chains: { neck: ['neck', 'head'] } });
    const gazer = { neck: 'neck', eyes: (pose: Frame['prev'], out: Vector3) => pose.point(2, new Vector3(0, 0.05, 0.08), out), range: { down: 0.5, up: 0.35, side: 0.35 } };
    /** the head's speed (rad/s) every step of a look `yaw` aside, and how far it turned */
    const look = (yaw: number) => {
      const eyes = new Vector3(0, 1.65, 0.08);
      const body = new Body(skeleton, lookAt(gazer, eyes.clone().add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(3)), SHIFT));
      const speeds: number[] = [];
      let last = new Quaternion();
      for (let k = 0; k < 180; k++) {
        body.update(dt);
        speeds.push(body.pose.rotation(2).angleTo(last) / dt);
        last = body.pose.rotation(2).clone();
      }
      return { speeds: speeds.slice(1), turned: last.angleTo(new Quaternion()) };
    };
    const small = look(0.35);
    const large = look(1.4);
    const peak = (s: number[]) => Math.max(...s);
    // (100°/s + 2.3°/s per degree turned at the peak: the large shift's head about twice as fast, neither at SHIFT's 6 rad/s)
    expect(peak(large.speeds) / peak(small.speeds)).toBeGreaterThan(1.8);
    expect(peak(large.speeds)).toBeLessThan(1.75 + 2.5 * large.turned);
    expect(peak(small.speeds)).toBeLessThan(1.75 + 2.5 * small.turned);
    // (a bell: up to its peak and down from it, no plateau at a cap)
    const top = large.speeds.indexOf(peak(large.speeds));
    expect(large.speeds.filter((v) => v > 0.95 * peak(large.speeds)).length).toBeLessThan(0.25 * large.speeds.filter((v) => v > 0.05).length);
    expect(top).toBeGreaterThan(3);
  });
});
