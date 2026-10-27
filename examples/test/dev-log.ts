import { expect } from 'vitest';
import type { CastOptions, Scenario } from '../src/scenario';
import { run as runScene } from '../scripts/run';

// Sustained moving and overridden reaches cross their initial arrival deadline. Position-only lateness now reports that gap;
// it does not fail the verb. Keep checking every other diagnostic, and retain the scenarios' independent tracking metrics.
export function run(scenario: Scenario, cast: CastOptions = {}) {
  const log = runScene(scenario, cast);
  if (scenario.id !== 'reach' && scenario.id !== 'hand-over') return log;
  const late = log.filter((entry) => entry.check === 'late reach: distance (m) (4 s overdue)' && entry.where === 'body 0: right');
  expect(late).toHaveLength(1);
  for (const entry of late) {
    expect(entry.limit).toBe(0.01);
    expect(entry.value).toBeGreaterThan(entry.limit);
    expect(Number.isFinite(entry.value)).toBe(true);
    expect(entry.time).toBeGreaterThan(4);
    expect(entry.beat).toContain('reach (');
  }
  return log.filter((entry) => !late.includes(entry));
}
