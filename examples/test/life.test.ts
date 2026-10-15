import { expect, it } from 'vitest';
import { INDEX, type Side } from '@drawcall/animate';
import { Life } from '../../packages/animate/src/humanoid/balance/life';
import { reachAround } from '../src/scenarios/life';
import { Simulation } from '../src/simulation';

it('reaches every reach-around target standing, without asking for a squat', () => {
  const sim = new Simulation(reachAround);
  const reached = new Set<number>();
  while (sim.t < reachAround.duration) {
    sim.step();
    const h = sim.actors[0];
    expect(h.asks.lower).toBe(0);
    expect(h.pose.position(INDEX.hips).y).toBeGreaterThan(h.proportions.hipHeight - 0.08);
    sim.props().forEach(({ position }, i) => {
      if (h.pose.position(INDEX.rightHand).distanceTo(position) < 0.01) reached.add(i);
    });
  }
  expect(reached.size).toBe(3);
  expect(sim.stage.done()).toBe(true);
});

it('seeds the first weight-shift side and alternates later shifts, including after activity', () => {
  for (const seed of [0, 1, 42]) {
    const life = new Life(seed);
    const shifts: Side[] = [];
    let previous: Side | null = null;
    for (let step = 0; step < 6000; step++) {
      life.update(0.1, step < 2000 || step >= 2100, 0);
      if (life.onto && life.onto !== previous) shifts.push(life.onto);
      previous = life.onto;
    }
    expect(shifts.length).toBeGreaterThan(8);
    expect(shifts.every((side, i) => i === 0 || side !== shifts[i - 1])).toBe(true);
  }
});
