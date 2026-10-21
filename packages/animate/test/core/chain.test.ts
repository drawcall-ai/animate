import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Pose, type Skeleton } from '../../src';
import { solveChain } from '../../src/rig';
import { beyond } from '../../src/core/limits';
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

  it('points a limb straight at a goal out of reach', () => {
    const pose = solve(leg(), { tip: { position: new Vector3(0.1, 1, 2) }, pole: new Vector3(0, 1, 1) });
    expect(pose.position(3).distanceTo(new Vector3(0.1, 1, 0.85))).toBeLessThan(1e-9);
  });

  it('keeps every bone within its limit', () => {
    // the knee bends only back (+x), the pole asks for it forward
    const skeleton = leg([hinge(2, 0, 2.4)]);
    const pose = solve(skeleton, { tip: { position: new Vector3(0.1, 0.5, 0.2) }, pole: new Vector3(0.1, 0.6, 2) });
    expect(Math.max(...excess(pose))).toBeLessThan(1e-9);
    const free = solve(leg(), { tip: { position: new Vector3(0.1, 0.5, 0.2) }, pole: new Vector3(0.1, 0.6, 2) });
    expect(beyond(free.local(2), hinge(2, 0, 2.4))).toBeGreaterThan(0.5);
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

  it('writes with a weight, blended over what is there', () => {
    const skeleton = leg();
    const full = solve(skeleton, { tip: { position: new Vector3(0.3, 0.35, 0.25) } });
    const half = solve(skeleton, { tip: { position: new Vector3(0.3, 0.35, 0.25) } }, 0.5);
    const rest = new Pose(skeleton);
    for (const b of [1, 2]) expect(half.local(b).angleTo(rest.local(b).clone().slerp(full.local(b), 0.5))).toBeLessThan(1e-7);
  });
});
