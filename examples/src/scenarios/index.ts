import type { Scenario } from '../scenario';
import { lookAround } from './tracking';
import { stroll, walkRun, walkTray } from './walk';

/** the scenarios the app lists (ids keyed into the metric limits) */
export const SCENARIOS: readonly Scenario[] = [stroll, walkRun, walkTray, lookAround];
