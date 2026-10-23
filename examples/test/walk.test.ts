import { expect, it } from 'vitest';
import type { CharacterModel } from '@pmndrs/viverse';
import { stroll } from '../src/scenarios/stroll';
import { legsBiped } from '../src/scenarios/legs';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { failed, measure, walkingForm } from './metrics';
import { SKELETONS, skeletonModel } from '../src/skeletons';
import type { Frame } from './frame';

// A walk's form as people walk (`walkingForm`: the stance's share, the trunk's lean, the elbows, the pelvis's rise and fall) on the
// default body and on skeletons unlike it, on both legs: the stroll's (a go-there point, balance) and a player's (the stepper under a
// scripted root).
const BODIES: [string, (() => CharacterModel) | undefined][] = [['default body', undefined],
  ...Object.entries(SKELETONS).map(([name, { joints, height }]): [string, () => CharacterModel] => [`the ${name}`, () => skeletonModel(joints, height)])];
const WALKS: [string, () => Scenario][] = [['strolling after a point', stroll], ['stepping under a scripted root', legsBiped]];

/**
 * Open (expected to fail: each one fixed comes off the list): the outlier's short legs, stepping under a scripted root, stand 65% of the
 * stride (≤ 0.65) — its quick cadence takes the stepper's one sub-step late lift-off as 2% more. Stance shortening with a dynamically
 * similar pace (Hebenstreit et al. 2015, −0.3% of the cycle per 0.1 m/s) would cure it, but moved the shooter's sprints past their joint
 * accelerations.
 */
const OPEN = new Set(['stepping under a scripted root, the outlier walks as people do']);

for (const [body, model] of BODIES) for (const [walk, scenario] of WALKS) {
  (OPEN.has(`${walk}, ${body} walks as people do`) ? it.fails : it)(`${walk}, ${body} walks as people do`, () => {
    const sim = new Simulation(scenario(), model);
    const m = measure(sim.scenario.id, (function* (): Generator<Frame[]> {
      while (sim.t < sim.scenario.duration) {
        sim.step();
        yield [{ t: sim.t, h: sim.actors[0], asked: sim.stage.report.at(sim.t), solids: [] }];
      }
    })());
    const g = m.gait.summary(false, false);
    expect(m.gait.strides.filter((s) => !s.curve).length, 'steady straight strides').toBeGreaterThanOrEqual(3);
    if (!g) throw new Error('no steady straight strides');
    expect(walkingForm(g, false).filter(failed).map((c) => `${c.what}: ${c.value.toFixed(3)} (${c.bound} ${c.limit})`)).toEqual([]);
  }, 30000);
}
