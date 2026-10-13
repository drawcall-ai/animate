import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RAMP, type Granted } from '../../src';
import { drive, run } from './drive';
import { arm, tip } from './rigs';

const origin = (bone: number) => ({ bone, at: new Vector3() });
const holdRoot = { point: origin(0), position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 };

describe('moving targets', () => {
  it('are followed at a constant velocity with no more lag than the inertia regularization leaves (mm)', () => {
    const speed = new Vector3(1.5, 0, 0.5);
    const lag = (owner: string | undefined) => {
      const body = drive(arm(), (ctx) => {
        const value = new Vector3(0, 1, 0).addScaledVector(speed, ctx.time + ctx.dt);
        ctx.propose.target({ kind: 'position', point: origin(0), value, weight: 1, owner });
        ctx.propose.target({ kind: 'orientation', point: origin(0), value: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2 * (ctx.time + ctx.dt)), weight: 1, owner });
      });
      run(body, 3);
      const t = body.time;
      return {
        position: body.state.position.distanceTo(new Vector3(0, 1, 0).addScaledVector(speed, t)),
        rotation: body.state.local[0].angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2 * t)),
      };
    };
    const tracked = lag('mover');
    expect(tracked.position).toBeLessThan(2e-3);
    expect(tracked.rotation).toBeLessThan(1e-3);
    // (a target without an owner has an identity too: its point and kind)
    expect(lag(undefined).position).toBeLessThan(2e-3);
  });

  it('feed nothing forward for a target proposed twice under one identity', () => {
    const body = drive(arm(), (ctx) => {
      const value = new Vector3(1 * (ctx.time + ctx.dt), 1, 0);
      ctx.propose.target({ kind: 'position', point: origin(0), value, weight: 0.5, owner: 'twin' });
      ctx.propose.target({ kind: 'position', point: origin(0), value, weight: 0.5, owner: 'twin' });
    });
    run(body, 3);
    // a 2 Hz spring trailing a target at 1 m/s: 2 / ω behind
    expect(body.state.position.distanceTo(new Vector3(body.time, 1, 0))).toBeGreaterThan(0.05);
  });
});

describe('strain and residuals', () => {
  it('tell a behaviour how far it was left off, before and after the projection', () => {
    let granted: Granted | undefined;
    const far = new Vector3(2, 1, 0);
    const body = drive(arm(), (ctx) => {
      granted = ctx.granted('reach');
      ctx.propose.contact({ ...holdRoot, owner: 'reach' });
      ctx.propose.target({ kind: 'position', point: tip(), value: far, weight: 1, owner: 'reach' });
    });
    run(body, 2);
    const g = granted;
    if (!g) throw new Error('never granted');
    // the arm straight out toward it: 2 − 0.85 m short
    expect(g.targets.length).toBe(1);
    expect(g.targets[0].strain.position).toBeCloseTo(2 - 0.85, 3);
    expect(g.won[0].strain.position).toBeLessThan(1e-3);
    expect(g.won[0].residual.position).toBeLessThan(1e-6);
  });

  it('report the strain of a contact the soft solve could not follow', () => {
    // the joints stuck: each step, only the projection keeps the tip on a contact moving 0.3 m/s
    let granted: Granted | undefined;
    const body = drive(arm(), (ctx) => {
      granted = ctx.granted('hand');
      for (let bone = 0; bone < 4; bone++) ctx.propose.cap({ bone, acceleration: 0 });
      ctx.propose.cap({ bone: 0, acceleration: 0, kind: 'translation' });
      const position = new Vector3(0.84, 1 + 0.3 * (ctx.time + ctx.dt), 0);
      ctx.propose.contact({ point: tip(), position, priority: 1, owner: 'hand' });
    });
    run(body, 0.3);
    const won = granted?.won[0];
    expect(won?.strain.position).toBeCloseTo(0.3 / 60, 3);
    expect(won?.residual.position).toBeLessThan(1e-6);
  });
});

describe('masks', () => {
  it('pull a position target only along the axes it weighs', () => {
    const goal = new Vector3(0.5, 0.2, 0.3);
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact(holdRoot);
      ctx.propose.target({ kind: 'position', point: tip(), value: goal, weight: 1, mask: new Vector3(1, 0, 1) });
    });
    run(body, 3);
    const p = body.state.point(tip(), new Vector3());
    expect(Math.hypot(p.x - goal.x, p.z - goal.z)).toBeLessThan(1e-5);
    // (the height is left to the arm's swing toward it, not pulled down to 0.2)
    expect(p.y).toBeGreaterThan(0.6);
  });

  it('let a contact hold a point on a plane while it slides', () => {
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact({ point: tip(), position: new Vector3(0, 1, 0), mask: new Vector3(0, 1, 0), priority: 1 });
      ctx.propose.target({ kind: 'position', point: tip(), value: new Vector3(0.5, 1.4, 0.4), weight: 1 });
    });
    run(body, 3, () => expect(Math.abs(body.state.point(tip(), new Vector3()).y - 1)).toBeLessThan(1e-6));
    const p = body.state.point(tip(), new Vector3());
    expect(Math.hypot(p.x - 0.5, p.z - 0.4)).toBeLessThan(1e-4);
  });
});

describe('contacts ramp in', () => {
  it('closing a gap from where the point was over a short window, not in one step', () => {
    const hold = new Vector3(0.85, 1.1, 0);
    const body = drive(arm(), (ctx) => ctx.propose.contact({ point: tip(), position: hold, priority: 1 }));
    const gaps: number[] = [];
    run(body, 0.2, () => gaps.push(body.state.point(tip(), new Vector3()).distanceTo(hold)));
    expect(gaps[0]).toBeGreaterThan(0.05);
    const ramped = Math.ceil(RAMP * 60) - 1;
    gaps.slice(ramped).forEach((g) => expect(g).toBeLessThan(1e-6));
    for (let i = 1; i <= ramped; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
  });
});
