import { idleLife, reachAround, liftHeavy } from './life';
import type { Scenario } from '../scenario';
import { legsBiped, legsHorse } from './legs';
import { handOver } from './handover';
import { knightArming } from './knight';
import { pickupShelf } from './pickup';
import { stroll } from './stroll';
import { lookAround, reach, vr } from './tracking';

/** The scenarios the app and headless runner list. */
export const SCENARIOS: readonly Scenario[] = [stroll(), pickupShelf(), handOver, lookAround(), vr(), reach(), knightArming(), legsBiped(), legsHorse(), idleLife, reachAround, liftHeavy];
