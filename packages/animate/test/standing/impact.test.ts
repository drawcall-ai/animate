import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { INDEX, dt, person, run } from '../kit/bodies';
import { poseOf } from '../../src/index';

function supported(mass = 75) {
  const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0, support: new Vector3() };
  const body = person({ mass, drive: () => root, life: { seed: 7, steady: 1 } });
  run(body, 2);
  return body;
}

it('takes a shoulder impulse backward over planted feet and recovers continuously', () => {
  const body = supported(), before = {
    shoulder: poseOf(body).position(INDEX.rightUpperArm).clone(), chest: poseOf(body).rotation(INDEX.chest).clone(),
  };
  const feet = body.feet.map((foot) => foot.position.clone());
  body.applyImpulse(new Vector3(0, 0, -18), poseOf(body).position(INDEX.rightUpperArm));
  expect(poseOf(body).rotation(INDEX.chest).angleTo(before.chest)).toBe(0);
  let back = 0, turn = 0, mostStep = 0, previous = poseOf(body).position(INDEX.rightUpperArm).clone();
  run(body, 1, () => {
    const shoulder = poseOf(body).position(INDEX.rightUpperArm);
    back = Math.max(back, before.shoulder.z - shoulder.z);
    turn = Math.max(turn, before.chest.angleTo(poseOf(body).rotation(INDEX.chest)));
    mostStep = Math.max(mostStep, shoulder.distanceTo(previous));
    previous.copy(shoulder);
    body.feet.forEach((foot, i) => {
      expect(foot.planted).toBe(true);
      expect(foot.position.distanceTo(feet[i])).toBeLessThan(0.01);
    });
  });
  expect(back).toBeGreaterThan(0.02);
  expect(turn).toBeGreaterThan(0.04);
  expect(mostStep).toBeLessThan(0.03);
  expect(poseOf(body).position(INDEX.rightUpperArm).distanceTo(before.shoulder)).toBeLessThan(0.015);
});

it('uses body mass and stays bounded under a burst of repeated impulses', () => {
  const peaks = [75, 150].map((mass) => {
    const body = supported(mass), chest = poseOf(body).rotation(INDEX.chest).clone();
    let peak = 0;
    for (let frame = 0; frame < 180; frame++) {
      if (frame < 60 && frame % 6 === 0) body.applyImpulse(new Vector3(0, 0, -18), poseOf(body).position(INDEX.rightUpperArm));
      body.update(dt);
      peak = Math.max(peak, chest.angleTo(poseOf(body).rotation(INDEX.chest)));
      expect(body.feet.every((foot) => foot.planted)).toBe(true);
    }
    expect(chest.angleTo(poseOf(body).rotation(INDEX.chest))).toBeLessThan(0.01);
    expect(peak).toBeLessThan(0.35);
    return peak;
  });
  expect(peaks[1]).toBeLessThan(peaks[0] * 0.65);
});
