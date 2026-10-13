import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { beyond, Body, type Limit } from '../../src';
import { drive, run } from './drive';
import { arm, biped, scaledArm, shoulder, tip } from './rigs';

const origin = (bone: number) => ({ bone, at: new Vector3() });
const about = (x: number, y: number, z: number, angle: number) => new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), angle);

describe('start pose', () => {
  it('starts the body in the given pose', () => {
    const local = [about(0, 1, 0, 0.3), about(0, 0, 1, -1), about(0, 0, 1, 0.5), new Quaternion()];
    const body = new Body(arm(), function* () {}, { position: new Vector3(1, 0, 0), local });
    body.state.local.forEach((q, i) => expect(q.angleTo(local[i])).toBeLessThan(1e-12));
    expect(body.state.positions[1].distanceTo(new Vector3(0.2, 0, 0).applyQuaternion(local[0]).add(new Vector3(1, 0, 0)))).toBeLessThan(1e-12);
    // `rotation` overrides the root's
    const turned = new Body(arm(), function* () {}, { local, rotation: new Quaternion() });
    expect(turned.state.local[0].angleTo(new Quaternion())).toBe(0);
    expect(() => new Body(arm(), function* () {}, { local: local.slice(1) })).toThrow(/3 rotations for 4 bones/);
  });
});

describe('limit-aware soft solve', () => {
  it('meets a target with the joints that can still move when a cheap one is at its stop', () => {
    const clavicle: Limit = { bone: 1, axis: 0, twist: [-0.05, 0.05], swing: [[-0.05, 0.05], [-0.05, 0.05]] };
    const goal = new Vector3(0.45, 1.5, 0.2);
    const hand = { bone: 4, at: new Vector3(0.1, 0, 0) };
    const body = drive(shoulder(), (ctx) => {
      ctx.propose.contact({ point: origin(0), position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 });
      ctx.propose.limit(clavicle);
      ctx.propose.target({ kind: 'position', point: hand, value: goal, weight: 1 });
    });
    let stopped = 0;
    run(body, 1, () => {
      expect(beyond(body.state.local[1], clavicle)).toBeLessThan(1e-9);
      if (beyond(body.state.local[1], { ...clavicle, twist: [-0.049, 0.049], swing: [[-0.049, 0.049], [-0.049, 0.049]] }) > 0) stopped++;
    });
    expect(stopped).toBeGreaterThan(30);
    // (a 2 Hz spring has closed > 99.5% of its error in 1 s; without the limit, a little more)
    expect(body.state.point(hand, new Vector3()).distanceTo(goal)).toBeLessThan(2e-3);
    run(body, 1);
    expect(body.state.point(hand, new Vector3()).distanceTo(goal)).toBeLessThan(1e-5);
  });

  it('meets a target around a capped joint', () => {
    const goal = new Vector3(0.45, 1.5, 0.2);
    const reach = (capped: boolean) => {
      const body = drive(shoulder(), (ctx) => {
        ctx.propose.contact({ point: origin(0), position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 });
        if (capped) ctx.propose.cap({ bone: 1, acceleration: 0 });
        ctx.propose.target({ kind: 'position', point: { bone: 4, at: new Vector3(0.1, 0, 0) }, value: goal, weight: 1 });
      });
      run(body, 1);
      return body;
    };
    const capped = reach(true);
    expect(capped.state.local[1].angleTo(new Quaternion())).toBeLessThan(1e-9);
    expect(capped.state.point({ bone: 4, at: new Vector3(0.1, 0, 0) }, new Vector3()).distanceTo(goal)).toBeLessThan(1e-3);
  });
});

describe('task-space springs', () => {
  it('move every joint serving a target in step, whatever their bones default to', () => {
    const goal = new Vector3(0.4, 1.4, 0.2);
    const path = (stiffness?: number[]) => {
      const body = drive(scaledArm(1, stiffness), (ctx) => {
        ctx.propose.contact({ point: origin(0), position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 });
        ctx.propose.target({ kind: 'position', point: tip(), value: goal, weight: 1, stiffness: 2 });
      });
      const out: Vector3[] = [];
      run(body, 1, () => out.push(body.state.point(tip(), new Vector3())));
      return out;
    };
    const same = path();
    const mixed = path([2, 9, 0.5, 30]);
    mixed.forEach((p, i) => expect(p.distanceTo(same[i])).toBeLessThan(1e-12));
    // the error closes at the target's stiffness, first order (never ahead of e^(−ωt))
    const e0 = same[0].distanceTo(goal);
    const w = 2 * Math.PI * 2;
    expect(same[29].distanceTo(goal) / e0).toBeGreaterThan(Math.exp(-w * 0.5) * 0.9);
  });

  it('pull a pose and a position alike at weight 1, whatever the rig size', () => {
    const settle = (scale: number) => {
      const body = drive(scaledArm(scale), (ctx) => {
        ctx.propose.contact({ point: origin(0), position: new Vector3(0, scale, 0), rotation: new Quaternion(), priority: 0 });
        ctx.propose.target({ kind: 'position', point: { bone: 3, at: new Vector3(0.1 * scale, 0, 0) }, value: new Vector3(0.4, 1.5, 0).multiplyScalar(scale), weight: 1 });
        for (const bone of [1, 2, 3]) ctx.propose.target({ kind: 'local', point: origin(bone), value: new Quaternion(), weight: 1 });
      });
      run(body, 4);
      return body.state.local.map((q) => q.clone());
    };
    const small = settle(1);
    const large = settle(2);
    expect(scaledArm(2).length).toBeCloseTo(2 * arm().length, 12);
    expect(arm().length).toBeCloseTo(0.8, 12);
    small.forEach((q, i) => expect(q.angleTo(large[i])).toBeLessThan(1e-4));
    // (a compromise: neither the pose nor the position won outright)
    expect(small[1].angleTo(new Quaternion())).toBeGreaterThan(0.05);
  });
});

describe('damped projection', () => {
  it('meets unreachable contacts as closely as it can (least squares), never NaN, and reports the residuals', () => {
    const far = new Vector3(3, 1, 0);
    const residuals = { root: 0, hand: 0 };
    const body = drive(arm(), (ctx) => {
      for (const owner of ['root', 'hand'] as const) for (const c of ctx.granted(owner).won) residuals[owner] = c.residual.position;
      ctx.propose.contact({ point: origin(0), position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 1, owner: 'root' });
      ctx.propose.contact({ point: tip(), position: far, priority: 1, owner: 'hand' });
    });
    run(body, 1, () => {
      for (const p of body.state.positions) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    });
    // the arm straight out, the 3 − 0.85 m it is short shared between the root and the hand
    expect(residuals.root).toBeGreaterThan(0.1);
    expect(residuals.hand).toBeGreaterThan(0.1);
    expect(residuals.root + residuals.hand).toBeCloseTo(3 - 0.85, 3);
  });

  it('stays finite on straight legs pushed past their reach', () => {
    let feet: Vector3[] | undefined;
    const ankle = (b: number) => ({ bone: b, at: new Vector3() });
    let hips = 0;
    const sk = biped();
    const body = drive(
      sk,
      (ctx) => {
        hips = ctx.granted('hips').won[0]?.residual.position ?? 0;
        feet ??= [4, 7].map((b) => ctx.body.point(ankle(b), new Vector3()));
        ctx.propose.contact({ point: ankle(4), position: feet[0], priority: 1 });
        ctx.propose.contact({ point: ankle(7), position: feet[1], priority: 1 });
        ctx.propose.contact({ point: origin(0), position: new Vector3(0, 1.3, 0), priority: 1, owner: 'hips' });
      },
      { local: sk.bones.map(() => new Quaternion()) },
    );
    run(body, 1, () => {
      expect(body.state.positions.every((p) => Number.isFinite(p.x + p.y + p.z))).toBe(true);
      expect(body.state.rates.every((r) => Number.isFinite(r.x + r.y + r.z))).toBe(true);
    });
    expect(hips).toBeGreaterThan(0);
  });
});
