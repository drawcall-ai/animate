import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, seeded } from '../scripts/run';
import { cases } from '../../packages/animate/test/open';

// Every scenario's run with development checks on: its dev log empty and its story finished; and a few of them varied (each person
// up to 10 cm off, turned up to 0.15 rad, up to 4 % taller or shorter), which no story may hang on. Open cases are expected to fail:
// each one fixed comes off the list.
const test = cases([]);
for (const scenario of SCENARIOS) {
  test(`${scenario.id}: final-pose dev checks${scenario.id === 'vr' ? ' (its side-step unfinished, known)' : ''}`, () => {
    expect(run(scenario).filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}

for (const scenario of SCENARIOS.filter((each) => ['reach', 'knight-arming', 'pickup-shelf'].includes(each.id))) {
  it.each([1, 2, 3, 4])(`${scenario.id}: variation #%s final-pose dev checks`, (seed) => {
    expect(run(scenario, { vary: seeded(seed) })).toEqual([]);
  });
}
