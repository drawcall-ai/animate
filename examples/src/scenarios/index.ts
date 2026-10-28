import type { Scenario } from '../scenario';
import { shooter } from './shooter';
import { stableMorning } from './stable-morning';
import { stroll } from './stroll';
import { proportions } from './proportions';
import { pickupShelf } from './pickup';
import { reachOverride } from './handover';
import { lookAround, reaching, vr } from './tracking';
import { knightArming } from './knight';
import { legsBiped, legsHorse } from './legs';
import { dogFetch } from './dog';
import { lionRun } from './lion';
import { idleLife, liftHeavy, reachAround } from './life';
import { gestures } from './gestures';

/** The scenarios the app and headless runner list. */
export const SCENARIOS: readonly Scenario[] = [shooter(), stableMorning(), stroll(), proportions(), pickupShelf(), reachOverride, lookAround(), vr(), reaching(), knightArming(), legsBiped(), legsHorse(), dogFetch(), lionRun(), idleLife, reachAround, liftHeavy, gestures];
