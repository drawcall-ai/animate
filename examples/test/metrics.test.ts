// Objective motion metrics per scenario, judged by the universal rules and the limits of its id
// (judge.ts). Run: pnpm metrics [-- -t <id>]
import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { createWorld, type Frame as BodyFrame, type World } from '@drawcall/animate';
import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import type { Frame } from './frame';
import { judge, LIMITS, limitsOf, measure } from './judge';

/** each fixed step's frames of a run of `sc` (OpenPose models, read without rendering) */
function* steps(sc: Scenario): Generator<Frame[]> {
  const sim = new Simulation(sc);
  while (sim.t < sc.duration) {
    sim.step();
    yield sim.actors.map((h) => ({ t: sim.t, h }));
  }
}

it('lists each scenario once', () => {
  const ids = SCENARIOS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// (the scenarios without limits are not judged yet: they only have to run)
for (const sc of SCENARIOS) {
  if (!(sc.id in LIMITS)) {
    it(`${sc.id} runs`, () => console.log(measure(sc.id, steps(sc)).report));
    continue;
  }
  it(sc.id, () => {
    const limit = limitsOf(sc.id);
    const m = measure(sc.id, steps(sc));
    console.log(m.report);
    judge(m, limit);
  });
}

it('runs a scenario through the metrics: two actors standing still, relaxed, each reading the other', () => {
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
        yield* action<BodyFrame<World>>({ update: (f) => void seen.push(f.world.bodies[1 - index].com(new Vector3()).x) });
      },
  };
  const m = measure(still.id, steps(still));
  expect(m.rates.velocity.knee.value).toBe(0);
  expect(m.rom.worst.value).toBe(0);
  expect(seen.length).toBe(2 * 30);
  expect(seen.every((x, i) => Math.abs(x - (i % 2 === 0 ? 1 : -1)) < 0.05)).toBe(true);
  expect(m.report).toContain('== still (30 frames)');
});
