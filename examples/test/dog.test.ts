import { expect, it } from 'vitest';
import { dogFetch } from '../src/scenarios/dog';

it('a dog made of data only trots to a ball, takes it in its jaw and carries it back, the ball on its jaw throughout', () => {
  const stage = dogFetch().stage(true);
  const [dog] = stage.bodies ?? [];
  const jaw = dog.pose.skeleton.index('jaw'), paws = dog.species.legs!.chains.map((leg) => leg.joints[3].bone);
  let off = 0, taken = NaN, up = paws.map(() => false);
  const landed: number[][] = paws.map(() => []);
  for (let i = 0; i < 14 * 60; i++) {
    dog.update(1 / 60);
    const ball = dog.holding.jaw?.item;
    if (ball) {
      if (Number.isNaN(taken)) taken = dog.frame.time;
      off = Math.max(off, dog.pose.position(jaw).distanceTo(ball.current.position));
    }
    const now = paws.map((paw) => dog.pose.position(paw).y > 0.033);
    now.forEach((lifted, leg) => { if (up[leg] && !lifted && dog.locomotion.velocity.length() > 1) landed[leg].push(dog.frame.time); });
    up = now;
  }
  expect(stage.done()).toBe(true);
  expect(dog.log).toEqual([]);
  expect(taken).toBeGreaterThan(3);
  expect(off).toBeLessThan(0.01);
  // (trotting along: each fore paw lands with the hind paw across from it)
  for (const [fore, hind] of [[0, 3], [1, 2]]) {
    expect(landed[fore].length).toBeGreaterThan(3);
    for (const time of landed[fore]) expect(Math.min(...landed[hind].map((t) => Math.abs(t - time)))).toBeLessThan(0.06);
  }
});
