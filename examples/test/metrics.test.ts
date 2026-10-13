// Objective motion metrics per scenario, judged by the universal rules and the limits of its id
// (judge.ts). Run: pnpm metrics [-- -t <id>]
import { action } from '@pmndrs/timeline';
import { createWorld, type Ctx, type World } from '@drawcall/animate';
import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import type { Frame } from './frame';
import { judge, limitsOf, measure } from './judge';

/** each fixed step's frames of a run of `sc` (OpenPose models, read without rendering) */
function* steps(sc: Scenario): Generator<Frame[]> {
  const sim = new Simulation(sc);
  while (sim.t < sc.duration) {
    sim.step();
    const inputs = sim.inputs();
    const props = sim.props(inputs);
    yield sim.actors.map((h, i) => ({ t: sim.t, h, input: inputs[i], props }));
  }
}

it('lists each scenario once', () => {
  const ids = SCENARIOS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

for (const sc of SCENARIOS) {
  it(sc.id, () => {
    const limit = limitsOf(sc.id);
    const m = measure(sc.id, steps(sc));
    console.log(m.report);
    judge(sc, m, limit);
  });
}

it('runs a scenario through the metrics: two actors standing still in the T-pose, each reading the other', () => {
  const seen: number[] = [];
  const still: Scenario = {
    id: 'still',
    title: 'Standing still',
    duration: 0.49,
    actors: [{ position: { x: -1, z: 0 } }, { position: { x: 1, z: 0 }, yaw: Math.PI }],
    world: () => createWorld(),
    props: () => [],
    script: (_, index) =>
      function* () {
        yield* action<Ctx<World>>({ update: (ctx) => void seen.push(ctx.world.bodies[1 - index].com.x) });
      },
  };
  const m = measure(still.id, steps(still));
  // (a T-pose fails the free-arm rules: the rules that hold for any body standing still)
  expect(m.feet.slide).toBeLessThan(1e-6);
  expect(m.feet.hyper).toBe(0);
  expect(m.balance.xcomFrames).toBe(0);
  expect(m.balance.com).toBe(0);
  expect(m.targets.wrist).toBe(0);
  expect(seen.length).toBe(2 * 30);
  expect(seen.every((x, i) => Math.abs(x - (i % 2 === 0 ? 1 : -1)) < 0.05)).toBe(true);
  expect(m.report).toContain('== still (30 frames)');
});
