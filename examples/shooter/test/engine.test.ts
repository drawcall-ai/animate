import { describe, expect, it } from 'vitest';
import { Engine } from '../src/rover/engine';
import { DT } from './course';

/** Steps `engine` for `seconds` with the throttle at `throttle` and the road speed (m/s) given by `speed` at each moment. */
function run(engine: Engine, seconds: number, throttle: number, speed: (t: number) => number) {
  for (let t = 0; t < seconds; t += DT) engine.update(DT, throttle, speed(t));
}

describe('Engine', () => {
  it('turns over on the starter before it runs, and drives no wheels until then', () => {
    const engine = new Engine();
    engine.start();
    run(engine, 0.3, 1, () => 0);
    expect(engine.state).toBe('cranking');
    expect(engine.driving).toBe(false);
    run(engine, 2, 0, () => 0);
    expect(engine.running).toBe(true);
    expect(engine.rpm).toBeGreaterThan(700);
    expect(engine.rpm).toBeLessThan(1000);
    engine.stop();
    run(engine, 3, 0, () => 0);
    expect(engine.rpm).toBeLessThan(5);
  });

  it('changes up through the gears accelerating, cutting the drive for each change, and down straight to the gear for the speed', () => {
    const engine = new Engine();
    engine.start();
    run(engine, 1.5, 0, () => 0);
    const gears: number[] = [];
    let cut = false;
    for (let t = 0; t < 12; t += DT) {
      engine.update(DT, 1, 1.6 * t);
      if (gears.at(-1) !== engine.gear) gears.push(engine.gear);
      cut ||= !engine.driving;
      expect(engine.rpm).toBeLessThan(3900);
    }
    expect(gears).toEqual([1, 2, 3, 4]);
    expect(cut).toBe(true);
    // (off the throttle it stays in gear slowing; back on it, one change down)
    run(engine, 4, 0, (t) => 19 - 4 * t);
    expect(engine.gear).toBe(4);
    let changes = 0;
    for (let t = 0; t < 1; t += DT) {
      const gear = engine.gear;
      engine.update(DT, 1, 3);
      if (engine.gear !== gear) changes++;
    }
    expect(engine.gear).toBe(1);
    expect(changes).toBe(1);
    // (stopped in a high gear, it pulls away at once in first, and backs at once in reverse)
    run(engine, 2, 1, (t) => 4 + t);
    run(engine, 2, 0, () => 0);
    engine.update(DT, 1, 0);
    expect(engine.gear).toBe(1);
    expect(engine.driving).toBe(true);
    engine.update(DT, -1, 0);
    expect(engine.gear).toBe(-1);
    expect(engine.driving).toBe(true);
  });

  it('goes into reverse held back at a standstill', () => {
    const engine = new Engine();
    engine.start();
    run(engine, 1.5, 0, () => 0);
    run(engine, 0.8, -1, () => 0);
    expect(engine.gear).toBe(-1);
    expect(engine.load).toBeGreaterThan(0.9);
  });
});
