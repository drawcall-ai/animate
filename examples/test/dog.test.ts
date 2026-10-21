import { Euler } from 'three';
import { expect, it } from 'vitest';
import { dogFetch } from '../src/scenarios/dog';

it('a dog made of data only trots to a ball, takes it in its jaw and carries it back, its whole body riding on the trot', () => {
  const scenario = dogFetch(), stage = scenario.stage(true);
  const [dog] = stage.bodies ?? [];
  const s = dog.pose.skeleton, jaw = s.index('jaw'), withersAt = s.index('leftFore0'), pelvis = s.index('pelvis');
  const paws = dog.species.legs!.chains.map((leg) => leg.joints[3].bone);
  let off = 0, taken = NaN, up = paws.map(() => false);
  const landed: [time: number, trotting: boolean][][] = paws.map(() => []), withers: number[] = [], croup: number[] = [], roll: number[] = [], yaw: number[] = [];
  for (let i = 0; i < scenario.duration * 60; i++) {
    dog.update(1 / 60);
    const ball = dog.holding.jaw?.item;
    if (ball) {
      if (Number.isNaN(taken)) taken = dog.frame.time;
      off = Math.max(off, dog.pose.position(jaw).distanceTo(ball.current.position));
    }
    const speed = dog.locomotion.velocity.length(), trotting = speed > 1.2, now = paws.map((paw) => dog.pose.position(paw).y > 0.033);
    now.forEach((lifted, leg) => { if (up[leg] && !lifted) landed[leg].push([dog.frame.time, trotting]); });
    up = now;
    if (!trotting) continue;
    withers.push(dog.pose.position(withersAt).y); croup.push(dog.pose.position(pelvis).y);
    const turned = new Euler().setFromQuaternion(dog.pose.local(pelvis), 'YXZ');
    roll.push(turned.z / DEG); yaw.push(turned.y / DEG);
  }
  expect(stage.done()).toBe(true);
  expect(dog.log).toEqual([]);
  expect(taken).toBeGreaterThan(3);
  expect(off).toBeLessThan(0.01);
  // (trotting along: each fore paw lands with the hind paw across from it)
  for (const [fore, hind] of [[0, 3], [1, 2]]) {
    const along = landed[fore].filter(([, trotting]) => trotting);
    expect(along.length).toBeGreaterThan(3);
    for (const [time] of along) expect(Math.min(...landed[hind].map(([t]) => Math.abs(t - time)))).toBeLessThan(0.06);
  }
  // (the trunk bounces twice a stride, ±1.2–1.4 cm, withers and croup together; the pelvis rolls a few degrees and hardly yaws:
  // the references at `DOG`)
  const mean = (a: number[]) => a.reduce((sum, x) => sum + x, 0) / a.length, range = (a: number[]) => Math.max(...a) - Math.min(...a);
  const w = mean(withers), c = mean(croup), dips = withers.filter((x, i) => x < withers[i - 1] && x <= withers[i + 1] && x < w - 0.35 * range(withers)).length;
  const together = withers.reduce((sum, x, i) => sum + (x - w) * (croup[i] - c), 0) / Math.sqrt(withers.reduce((sum, x) => sum + (x - w) ** 2, 0) * croup.reduce((sum, x) => sum + (x - c) ** 2, 0));
  expect(range(withers)).toBeGreaterThan(0.015); expect(range(withers)).toBeLessThan(0.035);
  expect(together).toBeGreaterThan(0.9);
  const strides = landed[0].filter(([, trotting]) => trotting).length;
  expect(dips / strides).toBeGreaterThan(1.6); expect(dips / strides).toBeLessThan(2.6);
  expect(range(roll)).toBeGreaterThan(2); expect(range(roll)).toBeLessThan(8);
  expect(range(yaw)).toBeLessThan(5);
});

const DEG = Math.PI / 180;
