import type { Scenario } from '../scenario';
import { lookAround, reach, run, sit, stepOver, stroll, vr, walkTray } from './basic';
import { fight } from './fight';
import { pickupShelf } from './pickup';

export const SCENARIOS: Scenario[] = [walkTray, pickupShelf, stroll, run, sit, stepOver, reach, lookAround, vr, fight];
