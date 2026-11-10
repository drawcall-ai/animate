import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Body, humanoid } from '../../src/index';
import { variationOf } from '../../src/person/legs/variation';
import { PERSON } from '../../skills/animate/references/person';
import { SEED, sized, target, walked } from '../kit/gait';

describe('a person\'s cadence', () => {
  it.each([[1.75, 0.6], [1.75, 1.3], [1.55, 0.9], [2.1, 0.9], [2.1, 1.4]])('keeps the dynamically similar cadence: %s m tall at %s m/s', (height, speed) => {
    const body = sized(height), [gait] = walked([body], speed);
    expect(gait.cadence / (target(speed, height / 1.75) * variationOf(SEED).cadence)).toBeCloseTo(1, 1);
    expect(body.log).toEqual([]);
  });

});

describe('people of one build', () => {
  // (each its own: its variation seeded by where it was made, as its idle life is, unless a life seed is given)
  // (two given their own life seeds, 3 and 11, whose cadences are 4.8% apart at the spreads first given: placed anywhere, two may be
  // all but alike — at a 2% spread, a quarter of pairs within 1%; their cadences differ as their individualities do)
  it('walk side by side out of step: their cadences differ as they are, and their touchdowns drift across each other', () => {
    const person = (x: number, seed: number) => new Body(humanoid(PERSON), { dev: true, at: new Vector3(x, 0, 0), life: { seed } });
    const bodies = [person(0.7, 3), person(-0.7, 11)];
    const [a, b] = walked(bodies, 1.2), own = variationOf(11).cadence / variationOf(3).cadence;
    expect(Math.abs(own - 1)).toBeGreaterThan(0.01);
    // (as much as half again or as little as half their own difference: their strides vary by `STRIDES` one to the next, and a balance
    // quickens a step as it needs)
    expect((b.cadence / a.cadence - 1) / (own - 1)).toBeGreaterThan(0.5);
    expect((b.cadence / a.cadence - 1) / (own - 1)).toBeLessThan(1.5);
    const offsets = b.touchdowns.map((t) => Math.min(...a.touchdowns.map((m) => Math.abs(t - m))));
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeGreaterThan(0.1);
    for (const body of bodies) expect(body.log).toEqual([]);
  });

});

