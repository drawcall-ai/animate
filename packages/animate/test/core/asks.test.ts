import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createAsks, request } from '../../src/core/asks';

// (asks of several tasks combine one rule a field, whichever asks first)
it('combines asks by one rule a field, in either order', () => {
  const asks = [[{ bow: 0.3 }, { bow: -0.1 }], [{ bow: -0.1 }, { bow: 0.3 }]].map((order) => {
    const into = createAsks();
    for (const more of order) request(into, more);
    return into.bow;
  });
  expect(asks).toEqual([0.3, 0.3]);
  const up = createAsks();
  request(up, { lower: -0.02 });
  request(up, { lower: -0.05 });
  expect(up.lower).toBe(-0.05);
  const limited = createAsks();
  request(limited, { bowLimit: 0.6, twist: 0.2, lean: new Vector3(0.01, 0, 0) });
  request(limited, { bowLimit: 0.4, twist: -0.3, lean: new Vector3(0, 0, 0.005) });
  expect([limited.bowLimit, limited.twist, limited.lean!.x]).toEqual([0.4, -0.3, 0.01]);
  const face = { yaw: 1 };
  request(limited, { face });
  expect(limited.face).toBe(face);
});
