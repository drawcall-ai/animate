import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Body, humanoid, poseOf } from '../../src/index';
import { INDEX, dt, person } from '../kit/bodies';
import { leftOf } from '../kit/angles';
import { PERSON } from '../../skills/animate/references/person';

const DEG = Math.PI / 180;


/** a player's body set off to 1.4 m/s at 10 m/s², as a game controller does, walked and stopped as quickly: its trunk's pitch each sub-step (rad, + forward, hips → neck) */
function setOff() {
  const root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 };
  const h = person({ drive: () => root, dev: true });
  const pitch: number[] = [];
  for (let t = dt; t < 6; t += dt) {
    root.velocity.z += Math.max(-10 * dt, Math.min(10 * dt, (t > 1 && t < 3.5 ? 1.4 : 0) - root.velocity.z));
    root.position.addScaledVector(root.velocity, dt);
    h.update(dt);
    const trunk = poseOf(h).position(INDEX.neck).clone().sub(poseOf(h).position(INDEX.hips));
    pitch.push(Math.atan2(trunk.z, trunk.y));
  }
  return { pitch, log: h.log };
}

// (the root speeds up and slows down at 10 m/s², quicker than legs can: the trunk leans as a person's setting off at the pace legs give
// — over the first step, ~7° — read: Leteneur et al. 2013: the lean grows from the first knee movement (26%) to heel strike (100%) of a
// 0.96 s initiation, ~10°/s on average; a smooth rise peaks at about twice that, and the walk's own nod adds its ±~15°/s; before, the
// trunk was thrown 3° → 15° at up to 85°/s)
it('a player setting off and stopping quickly leans no quicker nor further than a person does', () => {
  const { pitch, log } = setOff();
  expect(log).toEqual([]);
  const rate = pitch.slice(1).map((x, i) => Math.abs(x - pitch[i]) / dt);
  expect(Math.max(...rate) / DEG).toBeLessThan(40);
  const lean = Math.max(...pitch.slice(60, 150)) - pitch[59];
  expect(lean / DEG).toBeGreaterThan(4);
  expect(lean / DEG).toBeLessThan(12);
});

/** a player's body rounding a 3 m circle to the left at 1.5 m/s, facing its way, after a run-up: its trunk's lean to its left each sub-step (rad, hips → neck) */
function bend(leaning: boolean) {
  const species = humanoid(PERSON), root = { position: new Vector3(), velocity: new Vector3(), yaw: 0 }, v = 1.5, r = 3;
  const body = new Body(leaning ? species : { ...species, inertia: undefined }, { drive: () => root }), lean: number[] = [];
  for (let t = dt; t < 10; t += dt) {
    const speed = Math.min(v, 2 * t), turning = t > 2 ? v * (t - 2) / r : 0;
    root.yaw = turning;
    root.velocity.set(Math.sin(turning), 0, Math.cos(turning)).multiplyScalar(speed);
    root.position.addScaledVector(root.velocity, dt);
    body.update(dt);
    const trunk = poseOf(body).position(INDEX.neck).clone().sub(poseOf(body).position(INDEX.hips));
    lean.push(Math.atan2(trunk.dot(leftOf(turning)), trunk.y));
  }
  return lean;
}

// (round the bend the root accelerates toward its centre, v² / r: 0.75 m/s², asking 4.4° of a lean; a person takes 0.6 of it, 2.6°, at the
// chest: the hips → neck line, which the pelvis does not roll with, shows part of that; measured against the same bend without the lean)
it('leans into a bend: its left side down round a left bend, no further than its share of atan(v² / r g)', () => {
  const leaning = bend(true), upright = bend(false);
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  const lean = mean(leaning.slice(300)) - mean(upright.slice(300));
  expect(lean / DEG).toBeGreaterThan(1);
  expect(lean / DEG).toBeLessThan(2.6);
});
