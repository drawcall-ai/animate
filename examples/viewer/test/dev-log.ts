import { expect } from 'vitest';
import type { CastOptions, Scenario } from '../src/scenario';
import { run as runScene } from '../scripts/run';

// Moving, overridden and slow positional reaches can cross their initial arrival deadline. Lateness now reports that gap;
// it does not fail the verb. Keep checking every other diagnostic, and retain the scenarios' independent tracking metrics.
export function run(scenario: Scenario, cast: CastOptions = {}) {
  const log = runScene(scenario, cast);
  if (!['reach', 'hand-over', 'reach-around'].includes(scenario.id)) return log;
  const late = log.filter((entry) => entry.check === 'late reach: distance (m)' && entry.where === 'body 0: right');
  if (scenario.id === 'reach-around') expect(late.length).toBeLessThanOrEqual(1);
  else expect(late).toHaveLength(1);
  for (const entry of late) {
    expect(entry.limit).toBe(0.01);
    expect(entry.value).toBeGreaterThan(entry.limit);
    expect(Number.isFinite(entry.value)).toBe(true);
    // (said once the hand has stopped short, past its planned arrival: not as the reach sets off)
    expect(entry.time).toBeGreaterThan(1);
    expect(entry.detail).toMatch(/^stopped \d+\.\d cm off it \(.*\): /);
    expect(entry.beat).toContain('reach (');
  }
  return log.filter((entry) => !late.includes(entry));
}
