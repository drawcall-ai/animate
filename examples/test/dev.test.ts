import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, vary } from '../scripts/run';

for (const sc of SCENARIOS) {
  it(`${sc.id}: final-pose dev checks${sc.id === 'vr' ? ' (underHead completion known)' : ''}`, () => {
    const log = run(sc);
    expect(log.filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}

for (const sc of SCENARIOS.filter((sc) => sc.id === 'reach' || sc.id === 'knight-arming')) {
  it.each([1, 2, 3, 4])(`${sc.id}: variation #%s final-pose dev checks`, (seed) => {
    expect(run(vary(sc, seed))).toEqual([]);
  });
}
