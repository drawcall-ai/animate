import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { walkTo } from '../../src/index';
import { person, play } from '../kit/bodies';
import { insides } from './insides';

// (a few steps back or aside, asked to face as it does, it keeps its facing — backing, side-stepping — slower than it walks: recalled,
// backward walking's self-selected pace ~60–70% of forward; further, it turns and walks)
it.each([
  ['back 1.3 m', new Vector3(0, 0, -1.3), true],
  ['aside 0.8 m', new Vector3(0.8, 0, 0), true],
  ['back 2 m', new Vector3(0, 0, -2), false],
] as const)('steps %s facing as it does: keeps its facing for a few steps, slower', (_, to, kept) => {
  const body = person({ dev: true }), h = insides(body);
  let arrived: boolean | undefined, turned = 0, fastest = 0;
  play(function* () { arrived = yield* walkTo(body, to, { face: 0 }); }, [body], 15, () => {
    turned = Math.max(turned, Math.abs(h.locomotion.facing));
    fastest = Math.max(fastest, h.locomotion.velocity.length());
    return arrived !== undefined;
  });
  expect(arrived).toBe(true);
  expect(body.position.distanceTo(to)).toBeLessThan(0.1);
  if (kept) {
    expect(turned).toBeLessThan(0.05);
    expect(fastest).toBeLessThan(0.9);
  } else expect(turned).toBeGreaterThan(Math.PI / 2);
  expect(body.log).toEqual([]);
});

it('a person asked 3 m/s runs there, in flight between its stances, and asked past its top says so', () => {
  const walk = (speed: number) => {
    const body = person({ dev: true, at: new Vector3(0, 0, -30), face: 0 }), h = insides(body);
    let peak = 0, flying = 0, done = false;
    play(function* () { yield* walkTo(body, new Vector3(), { speed }); done = true; }, [body], 40, () => {
      peak = Math.max(peak, h.locomotion.velocity.length());
      if (body.feet.every((foot) => !foot.planted)) flying++;
      return done;
    });
    return { peak, flying, done, said: body.log.filter((row) => row.check.startsWith('walk speed')) };
  };
  const run = walk(3), past = walk(6);
  expect(run.done).toBe(true);
  expect(run.peak).toBeCloseTo(3, 1);
  expect(run.flying).toBeGreaterThan(30);
  expect(run.said).toEqual([]);
  expect(past.peak).toBeCloseTo(4, 1);
  expect(past.said).toHaveLength(1);
});

