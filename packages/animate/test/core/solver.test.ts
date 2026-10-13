import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { beyond, RAMP, STIFFNESS, type Limit } from '../../src';
import { INERTIA_WEIGHT } from '../../src/core/fit';
import { drive, run } from './drive';
import { arm, biped, tip } from './rigs';

const heel = (bone: number) => ({ bone, at: new Vector3(0, -0.05, 0) });

describe('soft targets', () => {
  it('reach a position target at its stiffness, without overshoot', () => {
    const goal = new Vector3(0.55, 1.3, 0.1);
    const body = drive(arm(), (ctx) => ctx.propose.target({ kind: 'position', point: tip(), value: goal, weight: 1 }));
    const start = body.state.point(tip(), new Vector3());
    const span = goal.distanceTo(start);
    const dir = goal.clone().sub(start).normalize();
    const p = new Vector3();
    const remaining: number[] = [];
    run(body, 3, () => remaining.push(span - body.state.point(tip(), p).sub(start).dot(dir)));
    // (first order at the default stiffness: never ahead of e^(−ωt); uncapped, no ease-in)
    const w = 2 * Math.PI * STIFFNESS;
    remaining.slice(0, 30).forEach((r, i) => expect(r).toBeGreaterThan(Math.exp(-w * (i + 1) / 60) * span * 0.9));
    expect(Math.min(...remaining)).toBeGreaterThan(-1e-4);
    expect(body.state.point(tip(), p).distanceTo(goal)).toBeLessThan(1e-6);
  });

  it('follow a stiffer target faster', () => {
    const goal = new Vector3(0.55, 1.3, 0.1);
    const error = (stiffness: number) => {
      const body = drive(arm(), (ctx) => ctx.propose.target({ kind: 'position', point: tip(), value: goal, weight: 1, stiffness }));
      run(body, 0.25);
      return body.state.point(tip(), new Vector3()).distanceTo(goal);
    };
    expect(error(4)).toBeLessThan(error(2) / 3);
  });

  it('settle in conflict by their weights alone: the stiffer one gets there sooner, not more of its way', () => {
    const a = new Vector3(0.6, 1.3, 0.1);
    const b = new Vector3(0.5, 0.8, -0.1);
    const settle = (weight: number, stiffness: [number, number]) => {
      const body = drive(arm(), (ctx) => {
        ctx.propose.contact({ point: { bone: 0, at: new Vector3() }, position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 });
        ctx.propose.target({ kind: 'position', point: tip(), value: a, weight, stiffness: stiffness[0] });
        ctx.propose.target({ kind: 'position', point: tip(), value: b, weight: 1 - weight, stiffness: stiffness[1] });
      });
      run(body, 6);
      return body.state.point(tip(), new Vector3()).distanceTo(a.clone().multiplyScalar(weight).addScaledVector(b, 1 - weight));
    };
    expect(settle(0.5, [STIFFNESS, STIFFNESS])).toBeLessThan(1e-6);
    expect(settle(0.75, [1, 20])).toBeLessThan(1e-6);
  });

  it('move a heavy coordinate under a single target its whole part of the way each step', () => {
    // (the root's translation carries the whole arm: its inertia must not shorten the step)
    const goal = new Vector3(0.3, 1.2, -0.1);
    const root = { bone: 0, at: new Vector3() };
    const body = drive(arm(), (ctx) => ctx.propose.target({ kind: 'position', point: root, value: goal, weight: 1 }));
    // (its part of the way to where its weight against its inertia settles it: a position's row
    // weighs 1 per skeleton length, the root's translation its whole mass)
    const { mass, skeleton } = body.state;
    const part = (1 - Math.exp((-2 * Math.PI * STIFFNESS) / 60)) / (1 + INERTIA_WEIGHT * mass * skeleton.length ** 2);
    const p = new Vector3();
    let gap = body.state.point(root, p).distanceTo(goal);
    run(body, 0.5, () => {
      const now = body.state.point(root, p).distanceTo(goal);
      expect(Math.abs(gap - now - part * gap)).toBeLessThan(1e-6 * gap);
      gap = now;
    });
  });

  it('give a fallback only the remainder: a full main target overrides it', () => {
    const goal = new Vector3(0.5, 1.3, 0);
    const body = drive(arm(), (ctx) => {
      ctx.propose.target({ kind: 'position', point: tip(), value: goal, weight: 1 });
      ctx.propose.target({ kind: 'position', point: tip(), value: new Vector3(0.5, 0.7, 0), weight: 1, tier: 'fallback' });
    });
    run(body, 3);
    expect(body.state.point(tip(), new Vector3()).distanceTo(goal)).toBeLessThan(1e-5);
  });

  it('reach orientation, aim and local targets', () => {
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6);
    const look = new Vector3(0.3, 2, 0.4);
    const body = drive(arm(), (ctx) => {
      ctx.propose.target({ kind: 'orientation', point: { bone: 0, at: new Vector3() }, value: turn, weight: 1 });
      ctx.propose.target({ kind: 'local', point: { bone: 1, at: new Vector3() }, value: turn, weight: 1 });
      ctx.propose.target({ kind: 'aim', point: { bone: 3, at: new Vector3() }, axis: new Vector3(1, 0, 0), value: look, weight: 1 });
    });
    run(body, 4);
    const s = body.state;
    expect(s.rotations[0].angleTo(turn)).toBeLessThan(1e-5);
    expect(s.local[1].angleTo(turn)).toBeLessThan(1e-5);
    const axis = new Vector3(1, 0, 0).applyQuaternion(s.rotations[3]);
    expect(axis.angleTo(look.clone().sub(s.positions[3]))).toBeLessThan(1e-5);
  });
});

describe('momentum', () => {
  it('carries motion through a target jump and settles', () => {
    const goal = new Vector3(0.7, 1.3, 0.2);
    // (the root held still: caps bound joints, not the root's translation)
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact({ point: { bone: 0, at: new Vector3() }, position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 });
      ctx.propose.target({ kind: 'position', point: tip(), value: goal, weight: 1 });
      for (let bone = 0; bone < 4; bone++) ctx.propose.cap({ bone, acceleration: 10 });
    });
    const v = new Vector3();
    const speeds: Vector3[] = [];
    run(body, 0.3, () => speeds.push(body.state.pointVelocity(tip(), v).clone()));
    // jump the target back while the tip is moving
    const along = speeds[speeds.length - 1].clone().normalize();
    goal.set(0.6, 0.8, -0.2);
    run(body, 1, () => speeds.push(body.state.pointVelocity(tip(), v).clone()));
    const jump = 18;
    expect(speeds[jump - 1].length()).toBeGreaterThan(0.1);
    // the tip keeps moving the old way for a few steps, then turns: velocity is continuous
    for (let i = jump; i < jump + 3; i++) expect(speeds[i].dot(along)).toBeGreaterThan(0);
    expect(Math.min(...speeds.slice(jump).map((s) => s.dot(along)))).toBeLessThan(-0.05);
    // (about 10 rad/s² · 1/60 s on each joint, 0.65 + 0.35 + 0.1 m from the tip, and the arm's
    // turning; uncapped, the jump changes the tip's velocity by ~1 m/s in a step)
    for (let i = 1; i < speeds.length; i++) expect(speeds[i].distanceTo(speeds[i - 1])).toBeLessThan(0.25);
    run(body, 4);
    expect(body.state.pointVelocity(tip(), v).length()).toBeLessThan(1e-4);
    expect(body.state.point(tip(), new Vector3()).distanceTo(goal)).toBeLessThan(1e-4);
  });

  it('coasts and slowly stops where nothing pulls', () => {
    const body = drive(arm(), (ctx) => {
      if (ctx.time < 0.2 - 1e-9) ctx.propose.target({ kind: 'position', point: tip(), value: new Vector3(0.6, 1.5, 0), weight: 1 });
    });
    run(body, 0.2);
    const speed = body.state.rates[1].length();
    expect(speed).toBeGreaterThan(0.5);
    run(body, 1 / 60);
    expect(body.state.rates[1].length()).toBeCloseTo(speed * Math.exp(-1 / 60), 12);
  });
});

describe('contacts', () => {
  it('hold their point exactly while a soft target pulls elsewhere', () => {
    let feet: Vector3[] | undefined;
    const goal = new Vector3(0, 0.85, 0.1);
    const body = drive(biped(), (ctx) => {
      feet ??= [4, 7].map((b) => ctx.body.point(heel(b), new Vector3()));
      ctx.propose.contact({ point: heel(4), position: feet[0], priority: 1 });
      ctx.propose.contact({ point: heel(7), position: feet[1], priority: 1 });
      ctx.propose.target({ kind: 'position', point: { bone: 0, at: new Vector3() }, value: goal, weight: 1 });
    });
    const p = new Vector3();
    run(body, 3, () => {
      [4, 7].forEach((b, k) => expect(body.state.point(heel(b), p).distanceTo(feet![k])).toBeLessThan(1e-6));
    });
    expect(body.state.position.distanceTo(goal)).toBeLessThan(1e-3);
  });

  it('hold a rotation when given', () => {
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
    const hold = new Vector3(0.6, 1.1, 0.1);
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact({ point: tip(), position: hold, rotation: turn, priority: 0 });
      ctx.propose.target({ kind: 'position', point: { bone: 0, at: new Vector3() }, value: new Vector3(0, 0.8, 0), weight: 1 });
    });
    // (held exactly once its ramp-in from where the tip was is over)
    let step = 0;
    run(body, 1, () => {
      if (step++ * (1 / 60) < RAMP) return;
      expect(body.state.point(tip(), new Vector3()).distanceTo(hold)).toBeLessThan(1e-6);
      expect(body.state.rotations[3].angleTo(turn)).toBeLessThan(1e-6);
    });
  });

  it('move the centre of mass on a parabola exactly while limbs swing', () => {
    const g = 9.81;
    const v0 = new Vector3(1, 3, 0);
    let from: Vector3 | undefined;
    const body = drive(arm(), (ctx) => {
      from ??= ctx.body.com.clone();
      const t = ctx.time + ctx.dt;
      const at = from.clone().addScaledVector(v0, t).add(new Vector3(0, -0.5 * g * t * t, 0));
      ctx.propose.contact({ point: 'com', position: at, priority: 1 });
      ctx.propose.target({ kind: 'local', point: { bone: 1, at: new Vector3() }, value: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.sin(8 * t)), weight: 1, stiffness: 4 });
    });
    const ys: number[] = [];
    run(body, 0.5, () => ys.push(body.state.com.y));
    // (from rest, the contact's ramp-in takes the first steps)
    for (let i = Math.ceil(RAMP * 60) + 2; i < ys.length; i++) expect((ys[i] - 2 * ys[i - 1] + ys[i - 2]) * 3600).toBeCloseTo(-g, 3);
    // (the derived velocity is the end of the step's, the parabola's the step's mean: close, not equal)
    expect(body.state.comVelocity.x).toBeCloseTo(1, 1);
  });

  it('keep a fast-turning limb’s curve to the limb: a posed arm sweeping its tip round leaves the root where it is held', () => {
    // (each step's linear fit misses the arc by ~2 cm at the tip; the miss is the arm's to make up)
    const body = drive(arm(), (ctx) => {
      const t = ctx.time + ctx.dt;
      const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 3 * Math.PI * t);
      ctx.propose.contact({ point: tip(), position: new Vector3(0.65, 0, 0).applyQuaternion(turn).add(new Vector3(0.2, 1, 0)), priority: 1 });
      ctx.propose.target({ kind: 'local', point: { bone: 1, at: new Vector3() }, value: turn, weight: 1, stiffness: 20 });
      for (const bone of [2, 3]) ctx.propose.target({ kind: 'local', point: { bone, at: new Vector3() }, value: new Quaternion(), weight: 1, stiffness: 20 });
      ctx.propose.target({ kind: 'position', point: { bone: 0, at: new Vector3() }, value: new Vector3(0, 1, 0), weight: 1, stiffness: 20 });
      ctx.propose.target({ kind: 'orientation', point: { bone: 0, at: new Vector3() }, value: new Quaternion(), weight: 1, stiffness: 20 });
    });
    run(body, 1);
    let most = 0;
    run(body, 2, () => (most = Math.max(most, body.state.position.distanceTo(new Vector3(0, 1, 0)))));
    expect(most).toBeLessThan(2e-3);
  });

  it('pull the centre of mass with a soft target', () => {
    const goal = new Vector3(0.3, 1.2, 0);
    const body = drive(arm(), (ctx) => ctx.propose.target({ kind: 'position', point: 'com', value: goal, weight: 1 }));
    run(body, 4);
    expect(body.state.com.distanceTo(goal)).toBeLessThan(1e-5);
  });
});

describe('limits and caps', () => {
  const elbow: Limit = { bone: 2, axis: 0, twist: [-0.1, 0.1], swing: [[-0.2, 0.2], [-1, 0]] };

  it('never let a joint leave its limits', () => {
    const body = drive(arm(), (ctx) => {
      ctx.propose.limit(elbow);
      ctx.propose.target({ kind: 'position', point: tip(), value: new Vector3(0.2, 1.4, 0.3), weight: 1, stiffness: 5 });
      ctx.propose.target({ kind: 'local', point: { bone: 2, at: new Vector3() }, value: new Quaternion().setFromAxisAngle(new Vector3(1, 1, 0).normalize(), 2), weight: 1 });
    });
    let pushed = 0;
    run(body, 2, () => {
      const out = beyond(body.state.local[2], elbow);
      expect(out).toBeLessThan(1e-9);
      // (the joint is pressed against its limit, or the test proves nothing)
      const inside = beyond(body.state.local[2], { ...elbow, twist: [-0.09, 0.09], swing: [[-0.19, 0.19], [-0.99, -0.01]] });
      if (inside > 0) pushed++;
    });
    expect(pushed).toBeGreaterThan(60);
  });

  it('bound each joint acceleration by its merged cap', () => {
    const cap = 20;
    const body = drive(arm(), (ctx) => {
      ctx.propose.cap({ bone: 1, acceleration: cap / 2 });
      ctx.propose.cap({ bone: 1, acceleration: cap });
      ctx.propose.target({ kind: 'position', point: tip(), value: new Vector3(0.1, 1.6, 0), weight: 1, stiffness: 6 });
    });
    let last = body.state.rates[1].clone();
    let peak = 0;
    run(body, 1, () => {
      const a = body.state.rates[1].distanceTo(last) * 60;
      peak = Math.max(peak, a);
      last = body.state.rates[1].clone();
    });
    expect(peak).toBeLessThanOrEqual(cap + 1e-6);
    expect(peak).toBeGreaterThan(cap * 0.99);
  });

  it('brake a capped joint in time to stop at its goal, without overshoot or chatter', () => {
    const cap = 10;
    const turn = new Vector3(0, 0, 1);
    const goal = new Quaternion().setFromAxisAngle(turn, 1.2);
    const body = drive(arm(), (ctx) => {
      ctx.propose.contact({ point: { bone: 0, at: new Vector3() }, position: new Vector3(0, 1, 0), rotation: new Quaternion(), priority: 0 });
      ctx.propose.cap({ bone: 1, acceleration: cap });
      ctx.propose.target({ kind: 'local', point: { bone: 1, at: new Vector3() }, value: goal, weight: 1, stiffness: 20 });
    });
    const left: number[] = [];
    run(body, 3, () => left.push(body.state.local[1].angleTo(goal)));
    // (the cap holds it back, so it goes at the cap: never past the goal, and ever closer to it)
    for (let i = 1; i < left.length; i++) expect(left[i]).toBeLessThanOrEqual(left[i - 1] + 1e-9);
    expect(body.state.rates[1].dot(turn)).toBeGreaterThan(-1e-9);
    expect(left[left.length - 1]).toBeLessThan(1e-6);
  });
});

describe('impulses', () => {
  it('kick a free end, which then settles back under its targets', () => {
    const rest = arm();
    const hold = rest.bones.map(() => new Quaternion());
    let frame = 0;
    // (momentum lives in the caps: a pulled joint brakes no faster than its cap allows)
    const body = drive(rest, (ctx) => {
      rest.bones.forEach((_, bone) => ctx.propose.cap({ bone, acceleration: 60 }));
      ctx.propose.cap({ bone: 0, kind: 'translation', acceleration: 20 });
      hold.forEach((q, bone) => ctx.propose.target({ kind: 'local', point: { bone, at: new Vector3() }, value: q, weight: 1 }));
      ctx.propose.target({ kind: 'position', point: { bone: 0, at: new Vector3() }, value: rest.bones[0].offset, weight: 1 });
      if (frame++ === 30) ctx.propose.impulse(tip(), new Vector3(0, 2, 0));
    });
    const before = new Vector3();
    run(body, 0.5, () => body.state.point(tip(), before));
    expect(body.state.pointVelocity(tip(), new Vector3()).length()).toBeLessThan(1e-9);
    run(body, 1 / 60);
    const v = body.state.pointVelocity(tip(), new Vector3());
    expect(v.y).toBeGreaterThan(1);
    let peak = 0;
    run(body, 3, () => (peak = Math.max(peak, body.state.point(tip(), new Vector3()).distanceTo(before))));
    expect(peak).toBeGreaterThan(0.02);
    expect(body.state.point(tip(), new Vector3()).distanceTo(before)).toBeLessThan(1e-4);
  });
});
