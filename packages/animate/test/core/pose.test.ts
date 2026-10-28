import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Pose } from '../../src/kernel/pose';
import { leg, turn } from './rigs';

describe('Pose', () => {
  it('derives world transforms by forward kinematics, again after a write', () => {
    const pose = new Pose(leg());
    expect(pose.position(3).toArray()).toEqual([0.1, 1 - 0.45 - 0.4, 0]);
    pose.setRoot(new Vector3(1, 2, 3));
    pose.setLocal(0, turn(0, 1, 0, Math.PI / 2));
    pose.setLocal(2, turn(1, 0, 0, Math.PI / 2));
    // the thigh's origin turned to −z; the knee bends the shin from −y to −z, both turned about y to −x
    expect(pose.position(1).distanceTo(new Vector3(1, 2, 3 - 0.1))).toBeLessThan(1e-12);
    expect(pose.position(3).distanceTo(new Vector3(1 - 0.4, 2 - 0.45, 3 - 0.1))).toBeLessThan(1e-12);
    expect(pose.rotation(3).angleTo(turn(0, 1, 0, Math.PI / 2).multiply(turn(1, 0, 0, Math.PI / 2)))).toBeLessThan(1e-7);
    expect(pose.point(3, new Vector3(0, 0, 0.1), new Vector3()).distanceTo(new Vector3(1 - 0.4, 2 - 0.45 - 0.1, 3 - 0.1))).toBeLessThan(1e-12);
  });

  it('blends a weighted write from what is there', () => {
    const pose = new Pose(leg());
    const bent = turn(1, 0, 0, 1);
    pose.setLocal(2, bent, 0.25);
    expect(pose.local(2).angleTo(turn(1, 0, 0, 0.25))).toBeLessThan(1e-7);
    pose.setRoot(new Vector3(0, 0, 0), 0.5);
    expect(pose.position(0).y).toBeCloseTo(0.5, 12);
    expect(() => pose.setLocal(2, new Quaternion(), 1.5)).toThrow(/weight/);
  });
});
