import type { CharacterModel } from '@pmndrs/viverse';
import { Simulation, type Scenario, type Shot, type Shown } from './scenario';
import { SCENARIOS } from './scenarios';
import { SCENARIOS as NEXT } from './next';
import { Showing, shotOf } from './next/simulation';

/** A scenario the app lists: what it shows, and how to start it. */
export interface Entry {
  shot: Shot;
  start(model?: () => CharacterModel): Shown;
}

const old = (s: Scenario): Entry => ({ shot: s, start: (model) => new Simulation(s, model) });

/** the old scenarios, each followed by its new-core recreation when there is one */
export const ENTRIES: readonly Entry[] = SCENARIOS.flatMap((s) => {
  const next = NEXT.find((n) => n.id === s.id);
  return next ? [old(s), { shot: shotOf(next), start: (model?: () => CharacterModel) => new Showing(next, model) }] : [old(s)];
});
