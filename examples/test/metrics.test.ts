// Objective motion metrics per scenario, judged by the universal rules and the limits of its id
// (judge.ts), and again under small changes to the scenarios. Run: pnpm metrics [-- -t <id>]
import { Vector3 } from 'three';
import { action } from '@pmndrs/timeline';
import { createWorld, type Frame as BodyFrame, type World } from '@drawcall/animate';
import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { pickupShelf } from '../src/scenarios/pickup';
import { stroll, walkThere } from '../src/scenarios/stroll';
import { Report } from '../src/report';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import type { Frame } from './frame';
import { judge, LIMITS, limitsOf, measure } from './judge';

/** each fixed step's frames of a run `sim` (OpenPose models, read without rendering) */
function* steps(sim: Simulation): Generator<Frame[]> {
  while (sim.t < sim.scenario.duration) {
    sim.step();
    const asked = sim.stage.report.at(sim.t);
    yield sim.actors.map((h) => ({ t: sim.t, h, asked }));
  }
}

/** a run of `sc` measured, held to its limits, and to what it is for */
function judged(sc: Scenario) {
  const sim = new Simulation(sc);
  const m = measure(sc.id, steps(sim));
  console.log(m.report);
  judge(m, limitsOf(sc.id));
  expect(sim.stage.done(), `${sc.id}: done`).toBe(true);
}

it('lists each scenario once', () => {
  const ids = SCENARIOS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// (the scenarios without limits are not judged yet: they only have to run)
for (const sc of SCENARIOS) {
  if (!(sc.id in LIMITS)) {
    it(`${sc.id} runs`, () => console.log(measure(sc.id, steps(new Simulation(sc))).report));
    continue;
  }
  it(sc.id, () => judged(sc));
}

// the same limits a little off the script: no metric may hang on its exact numbers
const VARIATIONS: [string, Scenario][] = [
  ['stroll 15% slower', stroll({ speed: 0.85 })],
  ['stroll 15% faster', stroll({ speed: 1.15 })],
  ['stroll on a 20% tighter arc', stroll({ radius: 2.4 })],
  ['stroll on a 20% wider arc', stroll({ radius: 3.6 })],
  ['stroll setting off turned 0.3 rad left', stroll({ yaw: 0.3 })],
  ['stroll setting off turned 0.3 rad right', stroll({ yaw: -0.3 })],
  ['stroll setting off turned a quarter turn away', stroll({ yaw: Math.PI / 2 })],
  ['stroll setting off facing away', stroll({ yaw: Math.PI })],
  ['stroll round a sharp 0.6 m turn', stroll({ radius: 0.6 })],
  ['walk to a point 2 m behind', walkThere(new Vector3(0, 0, -2))],
  ['walk to a point 2 m to the right', walkThere(new Vector3(-2, 0, 0))],
  ['turn round in place', walkThere(new Vector3(0, 0, 0), Math.PI)],
  ['pickup-shelf, the box 10 cm nearer', pickupShelf({ nearer: 0.1 })],
  ['pickup-shelf, the box 10 cm farther', pickupShelf({ nearer: -0.1 })],
  ['pickup-shelf, the box 5 cm higher', pickupShelf({ taller: 0.1 })],
  ['pickup-shelf, the box 5 cm lower', pickupShelf({ taller: -0.1 })],
  ['pickup-shelf, the shelf 5 cm lower', pickupShelf({ lower: 0.05 })],
  ['pickup-shelf, the box behind', pickupShelf({ around: Math.PI })],
];
for (const [name, sc] of VARIATIONS) it(name, () => judged(sc));

it('runs a scenario through the metrics: two actors standing still, relaxed, each reading the other', () => {
  const seen: number[] = [];
  const still: Scenario = {
    id: 'still',
    title: 'Standing still',
    duration: 0.49,
    actors: [{ position: { x: -1, z: 0 } }, { position: { x: 1, z: 0 }, yaw: Math.PI }],
    stage: () => ({
      world: createWorld(),
      report: new Report(),
      done: () => true,
      props: () => [],
      script: (_, index) =>
        function* () {
          yield* action<BodyFrame<World>>({ update: (f) => void seen.push(f.world.bodies[1 - index].com(new Vector3()).x) });
        },
    }),
  };
  const m = measure(still.id, steps(new Simulation(still)));
  expect(m.rates.velocity.knee.value).toBe(0);
  expect(m.rom.worst.value).toBe(0);
  expect(m.feet.slide).toBe(0);
  expect(m.balance.xcomFrames).toBe(0);
  expect(seen.length).toBe(2 * 30);
  expect(seen.every((x, i) => Math.abs(x - (i % 2 === 0 ? 1 : -1)) < 0.05)).toBe(true);
  expect(m.report).toContain('== still (30 frames)');
});
