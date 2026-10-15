import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run } from '../scripts/run';

for (const sc of SCENARIOS) {
  it(`${sc.id}: final-pose dev checks${sc.id === 'vr' ? ' (underHead completion known)' : ''}`, () => {
    const log = run(sc);
    expect(log.filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}
