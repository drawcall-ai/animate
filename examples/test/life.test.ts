import { expect, it } from 'vitest';
import { INDEX } from '@drawcall/animate';
import { reachAround } from '../src/scenarios/life';
import { Simulation } from '../src/simulation';
import { armInTrunk } from './clearance';

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

it('brings the right hand round the front of the trunk to the reach-around target behind it on the left', () => {
  const sim = new Simulation(reachAround);
  let deepest = 0;
  while (sim.t < reachAround.duration) {
    sim.step();
    deepest = Math.max(deepest, armInTrunk(sim.actors[0], 'right'));
  }
  expect(deepest).toBeLessThan(0.01);
});
