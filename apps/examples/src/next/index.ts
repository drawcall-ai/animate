import type { Scenario } from './scenario';
import { lookAround } from './scenarios/tracking';
import { stroll, walkRun, walkTray } from './scenarios/walk';

/** the scenarios rebuilt on @prohuman/humanoid's behaviours (ids as the old ones', which the metric limits are keyed by) */
export const SCENARIOS: readonly Scenario[] = [stroll, walkRun, walkTray, lookAround];
