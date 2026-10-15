import { expect, it } from 'vitest';
import { INDEX } from '@drawcall/animate';
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
