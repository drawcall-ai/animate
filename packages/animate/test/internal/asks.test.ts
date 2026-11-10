import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { Asks } from '../../src/kernel/asks';

// (what the parts ask of the stance combines one rule a field, whichever asks first)
it('combines what is asked by one rule a field, in either order', () => {
  const bows = [[{ bow: 0.3 }, { bow: -0.1 }], [{ bow: -0.1 }, { bow: 0.3 }]].map((order) => {
    const asks = new Asks();
    for (const asked of order) asks.add(asked);
    return asks.bow;
  });
  expect(bows).toEqual([0.3, 0.3]);
  const up = new Asks();
  up.add({ lower: -0.02 });
  up.add({ lower: -0.05 });
  expect(up.lower).toBe(-0.05);
  const limited = new Asks();
  limited.add({ bowLimit: 0.6, twist: 0.2, shift: new Vector3(0.01, 0, 0) });
  limited.add({ bowLimit: 0.4, twist: -0.3, shift: new Vector3(0, 0, 0.005) });
  expect([limited.bowLimit, limited.twist, limited.shift?.x]).toEqual([0.4, -0.3, 0.01]);
  const taken = limited.pass(new Asks());
  expect([taken.bowLimit, limited.bowLimit, limited.shift]).toEqual([0.4, Infinity, null]);
});

it("adds a story's posture onto what the parts ask, and clears it with the rest", () => {
  const asks = new Asks();
  asks.add({ bow: 0.2 });
  asks.add({ posture: { bow: -0.3, twist: 0.1, lean: 0.05, lower: 0.02 } });
  expect([asks.bow, asks.posture.bow, asks.posture.twist]).toEqual([0.2, -0.3, 0.1]);
  const taken = asks.pass(new Asks());
  expect([taken.posture.lean, taken.posture.lower, asks.posture.bow]).toEqual([0.05, 0.02, 0]);
});
