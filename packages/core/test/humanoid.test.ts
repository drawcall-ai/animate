import { Euler, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Humanoid, createSkeletonModel, type Input, type Options } from '../src';
import { CHILD_BONES, PARENT } from '../src/pose/bones';
import type { JointName } from '../src/pose/pose';
import { centreOfMass } from '../src/pose/mass';

const DT = 1 / 60;
const quat = (yaw: number, pitch = 0, roll = 0) => new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));

/** a body on a bare skeleton of the default proportions (or `height`) */
const body = (options?: Options, height?: number) => new Humanoid(createSkeletonModel(height), options);

/** the model's node for a bone or landmark */
function node(h: Humanoid, name: JointName): Object3D {
  const n = h.model.scene.getObjectByName(name);
  if (!n) throw new Error(`no ${name}`);
  return n;
}

/** a bone origin's or landmark's world position, read from the model */
const at = (h: Humanoid, name: JointName) => node(h, name).getWorldPosition(new Vector3());

/** every joint the solver computed (bones and landmarks) */
const joints = (h: Humanoid) => h['pose'].joints;

/** how far the model's bones and landmarks land from the solver's joints (m) */
function drift(h: Humanoid): number {
  h.model.scene.updateMatrixWorld();
  const j = joints(h);
  return Math.max(...Object.keys(j).map((name) => at(h, name as JointName).distanceTo(j[name as JointName])));
}

/** simulate `seconds`, returning the worst drift on the way */
function run(h: Humanoid, seconds: number, input: (t: number) => Input): number {
  let worst = 0;
  for (let t = 0; t < seconds; t += DT) {
    h.update(DT, input(t));
    worst = Math.max(worst, drift(h));
  }
  return worst;
}

describe('Humanoid', () => {
  it('stands plausibly', () => {
    const h = body();
    h.update(1);
    for (const p of Object.values(joints(h))) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    expect(at(h, 'nose').y).toBeGreaterThan(1.55);
    expect(at(h, 'hips').y).toBeGreaterThan(0.88);
    expect(h.feet.every((f) => f.phase === 'planted')).toBe(true);
  });

  it('walks to far hand targets and reaches them, feet never sliding', () => {
    const h = body();
    const target = { x: 0.15, y: 0.9, z: 3 };
    let slide = 0;
    const prev = h.feet.map((f) => f.position.clone());
    for (let i = 0; i < 60 * 6; i++) {
      h.update(DT, { leftHand: { position: target }, rightHand: { position: { x: -0.15, y: 0.9, z: 3 } } });
      h.feet.forEach((f, s) => {
        if (f.phase === 'planted') slide = Math.max(slide, f.position.distanceTo(prev[s]));
        prev[s].copy(f.position);
      });
    }
    expect(at(h, 'leftHand').distanceTo(new Vector3(target.x, target.y, target.z))).toBeLessThan(0.05);
    expect(slide).toBeLessThan(1e-6);
    expect(h.model.scene.position.z).toBeGreaterThan(2);
  });

  it('reads Object3D targets through their world matrix', () => {
    const parent = new Object3D();
    parent.position.set(0, 0.2, 0.3);
    const hand = new Object3D();
    hand.position.set(0.25, 0.9, 0.1);
    hand.quaternion.copy(quat(0.4, 0.3));
    parent.add(hand);
    parent.updateMatrixWorld(true);
    const h = body();
    run(h, 2, () => ({ leftHand: hand }));
    const want = hand.getWorldPosition(new Vector3());
    expect(at(h, 'leftHand').distanceTo(want)).toBeLessThan(0.02);
    // the hand bone takes the target's world rotation (the skeleton's bone frames are the normalized ones)
    const world = node(h, 'leftHand').getWorldQuaternion(new Quaternion());
    expect(world.angleTo(hand.getWorldQuaternion(new Quaternion()))).toBeLessThan(1e-6);
  });

  it('puts the eye midpoint on a head target', () => {
    const h = body();
    const head = { position: new Vector3(0.05, 1.55, 0.1), quaternion: quat(0.3, 0.2) };
    run(h, 3, () => ({ head }));
    const eyes = at(h, 'leftEye').add(at(h, 'rightEye')).multiplyScalar(0.5);
    expect(eyes.distanceTo(head.position)).toBeLessThan(0.02);
  });

  it('holds the goal facing while moving there', () => {
    const h = body();
    const facing = quat(Math.PI / 2);
    let worst = 0;
    for (let t = 0; t < 6; t += DT) {
      h.update(DT, { goal: { position: { x: 0, y: 0, z: 1.5 }, quaternion: facing } });
      if (t > 1.5) worst = Math.max(worst, Math.abs(h.yaw - Math.PI / 2));
    }
    expect(h.model.scene.position.z).toBeGreaterThan(1.4);
    expect(worst).toBeLessThan(0.2);
  });

  it("poses the model's bones and landmarks where the solver put them: walking, kicking, tracking, sitting", () => {
    const h = body({ stance: { blade: -0.4, stagger: 0.3, crouch: 0.05 } });
    let worst = run(h, 3, (t) => ({ goal: { position: { x: 0.5 * t, y: 0, z: t } }, lookAt: { x: 3, y: 1.5, z: 3 } }));
    worst = Math.max(worst, run(h, 1.5, (t) => ({ rightFoot: { position: { x: 1.5, y: 0.9, z: 3.8 }, weight: Math.sin(Math.PI * Math.min(1, t)) } })));
    worst = Math.max(worst, run(h, 3, (t) => ({ head: { position: { x: 1.4, y: 1.3 + 0.2 * Math.sin(t * 3), z: 3.1 }, quaternion: quat(t, 0.5) }, rightHand: { position: { x: 1.2, y: 0.5, z: 3.5 }, quaternion: quat(1, 2, 3) } })));
    worst = Math.max(worst, run(h, 5, () => ({ seat: { position: { x: 1, y: 0.46, z: 2 } } })));
    expect(h.seated).toBeGreaterThan(0.9);
    expect(worst).toBeLessThan(1e-5);
  });

  it('is pushed by a velocity change: the recoil and the ground velocity share it', () => {
    for (const at of ['head', 'chest'] as const) {
      const h = body();
      h.update(0.5);
      const before = centreOfMass(joints(h), new Vector3());
      h.push({ x: 0.4, y: 0, z: 0 }, at);
      h.update(DT);
      const v = centreOfMass(joints(h), new Vector3()).sub(before).divideScalar(DT);
      expect(v.x, at).toBeCloseTo(0.4, 1);
      run(h, 2, () => ({}));
      expect(h.model.scene.position.x).toBeGreaterThan(0.03);
    }
  });

  it('lifts a kicking foot once the weight is over the other, and never waits long', () => {
    for (const x of [0.1, 0.6]) {
      const h = body();
      let lifted = -1;
      for (let t = 0; t < 1 && lifted < 0; t += DT) {
        h.update(DT, { rightFoot: { position: { x: -x, y: 0.6, z: 0.5 } } });
        if (h.feet[1].phase === 'lifted') lifted = t;
      }
      expect(lifted).toBeGreaterThan(0);
      expect(lifted).toBeLessThan(0.45);
    }
  });

  it("takes the model's proportions", () => {
    expect(body({}, 2).proportions.height).toBe(2);
    const small = body({}, 1.5);
    small.update(1);
    expect(at(small, 'headTop').y).toBeCloseTo(1.5, 1);
    expect(() => new Humanoid(small.model)).toThrow(/already has a node named/);
  });

  it('keeps every bone at its rest length', () => {
    const h = body({}, 1.62);
    run(h, 2, (t) => ({ rightHand: { position: { x: -0.3, y: 1.9, z: 0.3 + t * 0.1 } } }));
    const j = joints(h);
    for (const b of CHILD_BONES) expect(Math.abs(j[b].distanceTo(j[PARENT[b]]) - h.proportions.offsets[b].length()), b).toBeLessThan(1e-9);
  });

  it('sub-steps long updates: update(0.1) is six 1/60 s steps', () => {
    const input: Input = { goal: { position: { x: 1, y: 0, z: 8 } }, rightHand: { position: { x: -0.3, y: 1.2, z: 0.6 } } };
    const once = body();
    const steps = body();
    for (let i = 0; i < 30; i++) {
      once.update(0.1, input);
      for (let k = 0; k < 6; k++) steps.update(DT, input);
    }
    expect(joints(once)).toEqual(joints(steps));
    // a janky frame of any length stays sane
    const z = once.model.scene.position.z;
    once.update(0.37, input);
    for (const p of Object.values(joints(once))) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    expect(at(once, 'hips').y).toBeGreaterThan(0.8);
    expect(once.model.scene.position.z).toBeGreaterThan(z);
  });

  it('stands as the stance asks', () => {
    const settled = (options: Options) => {
      const h = body(options);
      h.update(1);
      return h;
    };
    const width = (h: Humanoid) => at(h, 'leftFoot').distanceTo(at(h, 'rightFoot'));
    expect(width(settled({ stance: { width: 0.2 } })) - width(settled({}))).toBeGreaterThan(0.15);
    const guard = settled({ stance: { guard: true } });
    expect(at(guard, 'leftHand').y).toBeGreaterThan(at(guard, 'chest').y);
    expect(at(guard, 'rightHand').y).toBeGreaterThan(at(guard, 'chest').y);
    expect(at(settled({}), 'hips').y - at(settled({ stance: { crouch: 0.1 } }), 'hips').y).toBeGreaterThan(0.07);
  });

  it('walks in the style asked for: arm swing and hip motion scale', () => {
    /** peak-to-peak fore/aft swing of the left hand and pelvis yaw (relative to the root) over a walk */
    const swing = (h: Humanoid) => {
      const hand: number[] = [];
      const hips: number[] = [];
      for (let t = 0; t < 6; t += DT) {
        h.update(DT, { goal: { position: { x: 0, y: 0, z: 20 } } });
        if (t < 3) continue;
        hand.push(at(h, 'leftHand').z - at(h, 'hips').z);
        hips.push(new Euler().setFromQuaternion(node(h, 'hips').getWorldQuaternion(new Quaternion()), 'YXZ').y - h.yaw);
      }
      const range = (v: number[]) => Math.max(...v) - Math.min(...v);
      return { hand: range(hand), hips: range(hips) };
    };
    const natural = swing(body());
    const stiff = swing(body({ style: { armSwing: 0, hips: 0 } }));
    expect(stiff.hand).toBeLessThan(0.5 * natural.hand);
    expect(stiff.hips).toBeLessThan(0.5 * natural.hips);
  });
});
