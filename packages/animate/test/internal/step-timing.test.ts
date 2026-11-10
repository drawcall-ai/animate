import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { descent } from '../../src/step/stepper';

const forward = (speed = 3.5) => new Vector3(0, 0, speed);

it.each([[0.12, 0.28], [0.18, 0.4], [0.22, 0.55]])('fits %s m risers and %s m treads within the leg range without counting whole stairs', (riser, tread) => {
  const floor = (_x: number, z: number) => -Math.floor(z / tread) * riser;
  const cycle = 0.8, stroke = 0.65, speed = 3.5;
  let previous = 0;
  for (let frame = 0; frame < 120; frame++) {
    const z = frame * speed / 60;
    const share = descent(floor, new Vector3(0, floor(0, z), z), forward(speed), cycle, stroke);
    const drop = share * cycle * speed * riser / tread;
    expect(share).toBeLessThan(1);
    expect(drop).toBeGreaterThan(stroke * 0.9);
    expect(drop).toBeLessThan(stroke * 1.1);
    if (previous) expect(Math.abs(share / previous - 1)).toBeLessThan(0.15);
    previous = share;
  }
});

it('preserves flat, uphill, stationary and airborne timing and leaves disconnected ledges to physics', () => {
  const at = new Vector3();
  expect(descent(() => 0, at, forward(), 0.8, 0.65)).toBe(1);
  expect(descent((_x, z) => z * 0.5, at, forward(), 0.8, 0.65)).toBe(1);
  expect(descent((_x, z) => -z, at, forward(0), 0.8, 0.65)).toBe(1);
  expect(descent((_x, z) => -z, undefined, forward(), 0.8, 0.65)).toBe(1);
  expect(descent((_x, z) => z > 0.3 ? -0.75 : 0, at, forward(), 0.8, 0.65)).toBe(1);
});

it.each([0.5, 1, 2])('uses the same anatomical timing at body scale %s and any floor elevation', (scale) => {
  const floor = (_x: number, z: number) => -Math.floor(z / 0.4) * 0.18;
  const expected = descent(floor, new Vector3(), forward(), 0.8, 0.65);
  const scaled = (_x: number, z: number) => 12 + floor(0, z / scale) * scale;
  expect(descent(scaled, new Vector3(0, 12, 0), forward(3.5 * scale), 0.8, 0.65 * scale)).toBeCloseTo(expected, 12);
});
