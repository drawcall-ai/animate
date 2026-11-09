import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Pose } from '../../src/kernel/pose';
import type { Skeleton } from '../../src/kernel/skeleton';
import { solveChain } from '../../src/kernel/chain';
import { beyond } from '../../src/kernel/limits';
import { hinge, horseLeg, leg, turn } from './rigs';

const solve = (skeleton: Skeleton, ...args: Parameters<typeof solveChain> extends [unknown, unknown, ...infer R] ? R : never) => {
  const pose = new Pose(skeleton);
  solveChain({ current: pose }, 'leg', ...args);
  return pose;
};

/** how far each bone of the chain is beyond its limit (rad) */
const excess = (pose: Pose) => pose.skeleton.limits.map((l) => (l ? beyond(pose.local(l.bone), l) : 0));

describe('solveChain', () => {
  it('puts a limb’s tip on a reachable goal exactly, turned as asked, the knee toward the pole', () => {
    const skeleton = leg();
    const position = new Vector3(0.3, 0.35, 0.25);
    const quaternion = turn(1, 1, 0, 0.7);
    for (const pole of [new Vector3(0.1, 0.6, 2), new Vector3(2, 0.6, 0), new Vector3(0.1, 0.6, -2)]) {
      const pose = solve(skeleton, { tip: { position, quaternion }, pole });
      expect(pose.position(3).distanceTo(position)).toBeLessThan(1e-9);
      expect(pose.rotation(3).angleTo(quaternion)).toBeLessThan(1e-6);
      // the knee lies on the pole's side of the line from the hip to the goal
      const hip = pose.position(1);
      const line = position.clone().sub(hip).normalize();
      const side = (p: Vector3) => p.clone().sub(hip).projectOnPlane(line).normalize();
      expect(side(pose.position(2)).dot(side(pole))).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('extends a bent rest chain in its own plane, including after an unconstrained joint has turned', () => {
    const skeleton = leg();
    skeleton.bones[2].offset.set(0, .35, .57);
    skeleton.bones[3].offset.set(0, -.4, .5);
    const target = new Vector3(.1, -.1, .2);
    for (const rotation of [turn(1, 0, 0, 0), turn(1, 1, 1, .6), turn(0, 1, 0, .6)]) {
      const pose = new Pose(skeleton);
      pose.setLocal(2, rotation);
      solveChain({ current: pose }, 'leg', { tip: { position: target } });
      expect(pose.position(3).distanceTo(target)).toBeLessThan(1e-9);
    }
  });

  it('points a limb straight at a goal out of reach', () => {
    const pose = solve(leg(), { tip: { position: new Vector3(0.1, 1, 2) }, pole: new Vector3(0, 1, 1) });
    expect(pose.position(3).distanceTo(new Vector3(0.1, 1, 0.85))).toBeLessThan(1e-9);
  });

  it.each([1, -1])('keeps the bend plane when a limb extends through full reach from bend direction %s', (direction) => {
    const skeleton = leg([hinge(2, -2.7, 2.7)]);
    const pose = new Pose(skeleton);
    pose.setLocal(2, turn(1, 0, 0, direction * 0.2));
    const pole = new Vector3(0.1, 1, 1);
    const target = new Vector3(0.1, 0.15 + 1e-6, 0);
    solveChain({ current: pose }, 'leg', { tip: { position: target }, pole });
    for (const y of [0.15 - 1e-6, 0.15 + 1e-6]) {
      const before = pose.local(1).clone();
      target.y = y;
      solveChain({ current: pose }, 'leg', { tip: { position: target }, pole });
      expect(pose.local(1).angleTo(before)).toBeLessThan(0.01);
      expect(pose.position(3).distanceTo(target)).toBeLessThan(2e-6);
    }
  });

  it('keeps a constrained knee folded when its target crosses the opposite hinge direction', () => {
    const thigh = hinge(1, 0, 0);
    thigh.swing[0] = [0, 0];
    thigh.twist = [0, 0];
    const knee = hinge(2, -5 * Math.PI / 180, 155 * Math.PI / 180);
    const pose = new Pose(leg([thigh, knee]));
    const pole = new Vector3(0.1, 1, 1), target = new Vector3(0.1, 0.8, -1e-6);
    solveChain({ current: pose }, 'leg', { tip: { position: target }, pole, swivel: false });
    const before = pose.local(2).clone(), ankle = pose.position(3).clone();
    target.z = 1e-6;
    solveChain({ current: pose }, 'leg', { tip: { position: target }, pole, swivel: false });
    expect(beyond(pose.local(1), thigh)).toBeLessThan(1e-9);
    expect(beyond(pose.local(2), knee)).toBeLessThan(1e-9);
    expect(pose.local(2).angleTo(before), 'a 2 µm target move must not switch flexion to hyperextension').toBeLessThan(0.001);
    expect(pose.position(3).distanceTo(ankle)).toBeLessThan(0.001);
  });

  it('keeps every bone within its limit', () => {
    // the knee bends only back (+x), the pole asks for it forward
    const skeleton = leg([hinge(2, 0, 2.4)]);
    const pose = solve(skeleton, { tip: { position: new Vector3(0.1, 0.5, 0.2) }, pole: new Vector3(0.1, 0.6, 2) });
    expect(Math.max(...excess(pose))).toBeLessThan(1e-9);
    const free = solve(leg(), { tip: { position: new Vector3(0.1, 0.5, 0.2) }, pole: new Vector3(0.1, 0.6, 2) });
    expect(beyond(free.local(2), hinge(2, 0, 2.4))).toBeGreaterThan(0.5);
  });

  it('can prioritize a leg bend plane over a foot rotation outside the ankle range', () => {
    const skeleton = leg([hinge(2, 0, 2.4), hinge(3, -0.15, 0.15)]);
    const position = new Vector3(0.1, 0.5, -0.2), pole = new Vector3(0.1, 0.6, -2);
    const placed = solve(skeleton, { tip: { position }, pole });
    for (const angle of [-1, 1]) {
      const pose = solve(skeleton, { tip: { position, quaternion: turn(0, 0, 1, angle) }, pole, poleFirst: true });
      expect(pose.position(2).distanceTo(placed.position(2))).toBeLessThan(1e-9);
      expect(pose.position(3).distanceTo(position)).toBeLessThan(1e-9);
      expect(Math.max(...excess(pose))).toBeLessThan(1e-9);
    }
  });

  it('solves a longer chain (a horse’s hind leg) within its limits, onto a goal it can reach', () => {
    const skeleton = horseLeg();
    // a goal the leg reaches within its hinges: where it puts the hoof bent so
    const bent = new Pose(skeleton);
    [-0.5, 1.1, -1.2, 0.8].forEach((a, k) => bent.setLocal(k + 1, turn(1, 0, 0, a)));
    const goal = bent.position(5).clone();
    const pose = solve(skeleton, { tip: { position: goal, quaternion: bent.rotation(5) } });
    expect(pose.position(5).distanceTo(goal)).toBeLessThan(1e-4);
    expect(pose.rotation(5).angleTo(bent.rotation(5))).toBeLessThan(1e-6);
    expect(Math.max(...excess(pose))).toBeLessThan(1e-9);
    // and straight toward one out of reach
    const far = solve(horseLeg(), { tip: { position: new Vector3(0.2, -2, 0) } });
    expect(far.position(5).distanceTo(new Vector3(0.2, 1.4 - 1.4, 0))).toBeLessThan(1e-3);
  });
});
