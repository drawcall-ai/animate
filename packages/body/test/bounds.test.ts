import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { beyond, Board, merge, type Limit } from '../src/index.js';
import { drive, run } from './drive.js';
import { arm, biped, tip } from './rigs.js';

const origin = (bone: number) => ({ bone, at: new Vector3() });
const holdRoot = { point: origin(0), position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 };

describe('limits pin per axis', () => {
  it('let a joint at one stop keep turning the other ways', () => {
    // swing about z (the second cross axis of x) locked; about y and the twist free
    const hinge: Limit = { bone: 2, axis: 0, twist: [-1, 1], swing: [[-1, 1], [-0.01, 0.01]] };
    const want = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 1).normalize(), 1);
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact(holdRoot);
      ctx.propose.limit(hinge);
      ctx.propose.target({ kind: 'local', point: origin(2), value: want, weight: 1 });
    });
    run(body, 2, () => expect(beyond(body.state.local[2], hinge)).toBeLessThan(1e-9));
    // (pinned whole at the z stop it would barely have turned about y)
    const q = body.state.local[2];
    const aboutY = 2 * Math.atan2(q.y, q.w);
    expect(aboutY).toBeGreaterThan(0.5);
  });
});

describe('caps', () => {
  it('scale a joint to its cap along the way it wants to go, not freeze it', () => {
    const cap = 5;
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact(holdRoot);
      ctx.propose.cap({ bone: 1, acceleration: cap });
      ctx.propose.target({ kind: 'local', point: origin(1), value: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.5), weight: 1, stiffness: 5 });
    });
    run(body, 10 / 60);
    const r = body.state.rates[1];
    expect(r.length()).toBeCloseTo((10 * cap) / 60, 6);
    expect(r.angleTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
  });

  it('merge translation caps by max, only on the root', () => {
    const board = new Board();
    board.cap({ bone: 0, acceleration: 5, kind: 'translation' });
    board.cap({ bone: 0, acceleration: 9, kind: 'translation' });
    board.cap({ bone: 0, acceleration: 1 });
    const m = merge(board, arm());
    expect(m.translationCap).toBe(9);
    expect(m.caps[0]).toBe(1);
    board.cap({ bone: 2, acceleration: 1, kind: 'translation' });
    expect(() => merge(board, arm())).toThrow(/only the root/);
  });
});

describe('the root', () => {
  it('is never flung by a contact it cannot meet: bounded by its translation cap', () => {
    const cap = 20;
    const goal = new Vector3(0.85, 1, 0);
    const body = drive(arm(), (ctx) => {
      // every joint stuck: only the root can carry the tip
      for (let bone = 0; bone < 4; bone++) ctx.propose.cap({ bone, acceleration: 0 });
      ctx.propose.cap({ bone: 0, acceleration: cap, kind: 'translation' });
      ctx.propose.contact({ point: tip(), position: goal, priority: 1 });
    });
    run(body, 0.5);
    goal.set(2.85, 1, 0);
    let last = body.state.velocity.clone();
    let fastest = 0;
    run(body, 10, () => {
      const v = body.state.velocity;
      expect(v.distanceTo(last) * 60).toBeLessThanOrEqual(cap * (1 + 1e-6));
      fastest = Math.max(fastest, v.length());
      last = v.clone();
    });
    // (2 m at 20 m/s², accelerating half way and braking the rest, peaks at √(2 · 20 · 1) m/s)
    expect(fastest).toBeLessThan(Math.sqrt(2 * cap * 1) * 1.5);
    expect(body.state.point(tip(), new Vector3()).distanceTo(goal)).toBeLessThan(0.01);
  });

  it('stays put when stuck joints leave contacts unmeetable', () => {
    const sk = biped();
    const ankle = (b: number) => ({ bone: b, at: new Vector3() });
    let feet: Vector3[] | undefined;
    const body = drive(sk, (ctx) => {
      // the joints stuck, the root's turn capped: the feet drawn apart can't be followed
      for (let bone = 1; bone < sk.bones.length; bone++) ctx.propose.cap({ bone, acceleration: 0 });
      ctx.propose.cap({ bone: 0, acceleration: 1 });
      // (as a body always has: the root's translation capped too)
      ctx.propose.cap({ bone: 0, kind: 'translation', acceleration: 30 });
      feet ??= [4, 7].map((b) => ctx.body.point(ankle(b), new Vector3()));
      const apart = Math.min(ctx.time, 2);
      ctx.propose.contact({ point: ankle(4), position: feet[0].clone().add(new Vector3(apart, 0, 0)), priority: 1 });
      ctx.propose.contact({ point: ankle(7), position: feet[1].clone().add(new Vector3(-apart, 0, 0)), priority: 1 });
      ctx.propose.target({ kind: 'position', point: 'com', value: new Vector3(0, 1.1, 0), weight: 1 });
    });
    // (the projection splays the stuck legs as far as it can, the pelvis sinking with them;
    // nothing gains momentum it was not allowed, so nothing runs away)
    run(body, 10, () => {
      expect(body.state.velocity.length()).toBeLessThan(4);
      body.state.rates.forEach((r, bone) => expect(r.length()).toBeLessThan(bone === 0 ? 1 : 1e-9));
      expect(Math.abs(body.state.position.x)).toBeLessThan(0.1);
      expect(body.state.position.y).toBeGreaterThan(0);
    });
    expect(body.state.velocity.length()).toBeLessThan(0.01);
  });

  it('is the last thing the projection moves to meet a contact', () => {
    // the arm's joints too slow to follow a contact that jumps, the root slower still: the
    // projection meets it with the arm (beyond its caps), not by shifting the whole body
    const hold = new Vector3(0.85, 1, 0);
    const body = drive(arm(), (ctx) => {
      for (let bone = 0; bone < 4; bone++) ctx.propose.cap({ bone, acceleration: 1 });
      ctx.propose.cap({ bone: 0, acceleration: 1, kind: 'translation' });
      ctx.propose.contact({ point: tip(), position: hold, priority: 1, owner: 'hand' });
    });
    run(body, 0.2);
    hold.set(0.75, 1.15, 0.1);
    run(body, 0.5);
    expect(body.state.point(tip(), new Vector3()).distanceTo(hold)).toBeLessThan(1e-6);
    expect(body.state.position.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-3);
  });
});
