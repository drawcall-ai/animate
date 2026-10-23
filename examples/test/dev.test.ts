import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, vary } from '../scripts/run';
import { cases } from '../../packages/animate/test/open';

// Open: look-around's left upper arm comes 3.6 µm past the trunk's 1 cm at 15.05 s (expected to fail: fixed, it comes off the list).
const test = cases([['look-around: final-pose dev checks', [0, 3]]]);
for (const sc of SCENARIOS) {
  test(`${sc.id}: final-pose dev checks${sc.id === 'vr' ? ' (underHead completion known)' : ''}`, () => {
    const log = run(sc);
    expect(log.filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}

for (const sc of SCENARIOS.filter((sc) => ['reach', 'knight-arming', 'pickup-shelf'].includes(sc.id))) {
  it.each([1, 2, 3, 4])(`${sc.id}: variation #%s final-pose dev checks`, (seed) => {
    expect(run(vary(sc, seed))).toEqual([]);
  });
}
