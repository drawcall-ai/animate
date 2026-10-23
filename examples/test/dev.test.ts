import { expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenarios';
import { knownFailure, run, vary } from '../scripts/run';

// Open on the core legs, the people's only legs since 2026-10-23 (expected to fail: each one fixed comes off the list): the knight's
// hands are on its chin straps within 1 mm but settle on them only after the 4 s a reach may take.
const OPEN = new Set(['knight-arming: final-pose dev checks', 'knight-arming: variation #1 final-pose dev checks']);
const check = (title: string, body: () => void) => (OPEN.has(title) ? it.fails : it)(title, body);

for (const sc of SCENARIOS) {
  check(`${sc.id}: final-pose dev checks${sc.id === 'vr' ? ' (underHead completion known)' : ''}`, () => {
    const log = run(sc);
    expect(log.filter((entry) => !knownFailure(entry))).toEqual([]);
  });
}

for (const sc of SCENARIOS.filter((sc) => ['reach', 'knight-arming', 'pickup-shelf'].includes(sc.id))) {
  for (const seed of [1, 2, 3, 4]) check(`${sc.id}: variation #${seed} final-pose dev checks`, () => {
    expect(run(vary(sc, seed))).toEqual([]);
  });
}
