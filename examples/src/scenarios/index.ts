import type { Scenario } from '../scenario';
import { handOver } from './handover';

/** the scenarios the app lists (ids keyed into the metric limits, those that are judged) */
export const SCENARIOS: readonly Scenario[] = [handOver];
