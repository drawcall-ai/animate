import { describe, expect, it } from 'vitest';
import { Quaternion, Scene, Vector3 } from 'three';
import { Avatar } from '../src/avatar';
import { Puppet } from '../src/puppet';
import { cleanup } from './course';

function puppet() {
  const avatar = new Avatar(new Scene());
  avatar.reset(new Vector3());
  cleanup(() => avatar.dispose());
  return new Puppet(avatar.body);
}

describe('Puppet', () => {
  it('reaches a limb onto its target, the joint bending toward its pole and the end turned as asked', () => {
    const body = puppet();
    const shoulder = body.position('leftUpperArm');
    const wrist = shoulder.clone().add(new Vector3(0.15, -0.3, 0.3));
    const hand = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
    body.arm('left', wrist, new Vector3(0, -1, -1), hand);
    expect(body.position('leftHand').distanceTo(wrist)).toBeLessThan(1e-3);
    const middle = shoulder.clone().add(wrist).multiplyScalar(0.5);
    expect(body.position('leftLowerArm').sub(middle).dot(new Vector3(0, -1, -1))).toBeGreaterThan(0);
    expect(body.rotation('leftHand').angleTo(hand)).toBeLessThan(1e-3);

    const hip = body.position('rightUpperLeg');
    const ankle = hip.clone().add(new Vector3(0, -0.6, 0.35));
    body.leg('right', ankle, new Vector3(0, 0.3, 1), new Quaternion());
    expect(body.position('rightFoot').distanceTo(ankle)).toBeLessThan(1e-3);
    expect(body.position('rightLowerLeg').sub(hip.clone().add(ankle).multiplyScalar(0.5)).z).toBeGreaterThan(0);
  });

  it('rolls the forearm with the hand about its length, half the way', () => {
    const body = puppet();
    const wrist = body.position('leftUpperArm').add(new Vector3(0.15, -0.3, 0.3)), elbow = new Vector3(0, -1, -1);
    const base = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
    const forearm = (roll: number) => {
      // (the left arm's forearm runs along +X at rest)
      body.arm('left', wrist, elbow, base.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll)));
      return body.rotation('leftLowerArm');
    };
    expect(forearm(0.6).angleTo(forearm(-0.6))).toBeCloseTo(0.6, 1);
  });
});
