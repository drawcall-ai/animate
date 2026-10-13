import type { Scenario } from '../scenario';
import { handOver } from './handover';
import { pickupShelf } from './pickup';
import { stroll } from './stroll';

/** the scenarios the app lists (ids keyed into the metric limits, those that are judged) */
export const SCENARIOS: readonly Scenario[] = [stroll(), pickupShelf(), handOver];
