import { expect } from 'vitest';
import type { CharacterModel } from '@pmndrs/viverse';
import { stroll } from '../src/scenarios/stroll';
import { legsBiped } from '../src/scenarios/legs';
import type { Scenario } from '../src/scenario';
import { Simulation } from '../src/simulation';
import { failed, measure, walkingForm } from './metrics';
import { SKELETONS, skeletonModel } from '../src/skeletons';
import { frames } from './frame';
import { cases } from '../../packages/animate/test/open';

// A walk's form as people walk (`walkingForm`: the stance's share, the trunk's lean, the elbows, the pelvis's rise and fall) on the
// default body and on skeletons unlike it, on both legs: the stroll's (a go-there point, balance) and a player's (the stepper under a
// scripted root).
const BODIES: [string, (() => CharacterModel) | undefined][] = [['default body', undefined],
  ...Object.entries(SKELETONS).map(([name, { joints, height }]): [string, () => CharacterModel] => [`the ${name}`, () => skeletonModel(joints, height)])];
const WALKS: [string, () => Scenario][] = [['strolling after a point', stroll], ['stepping under a scripted root', legsBiped]];

/** Open (expected to fail: each one fixed comes off the list). */
const test = cases([
  // (on the core legs, the people's only legs since 2026-10-23: none of the outlier's straight strides is steady enough to judge)
  'strolling after a point, the outlier walks as people do']);

for (const [body, model] of BODIES) for (const [walk, scenario] of WALKS) {
  test(`${walk}, ${body} walks as people do`, () => {
    const sim = new Simulation(scenario(), model);
    const m = measure(sim.scenario.id, frames(sim));
    const g = m.gait.summary(false, false);
    expect(m.gait.strides.filter((s) => !s.curve).length, 'steady straight strides').toBeGreaterThanOrEqual(3);
    if (!g) throw new Error('no steady straight strides');
    expect(walkingForm(g, false).filter(failed).map((c) => `${c.what}: ${c.value.toFixed(3)} (${c.bound} ${c.limit})`)).toEqual([]);
  }, 30000);
}
