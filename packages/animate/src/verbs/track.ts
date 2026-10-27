import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { selfOf, type Body } from '../body/body';
import { personOf } from '../body/person';
import { heading } from '../look/head';
import { HOLD, reaching } from '../hands/person/arms';
import type { Side } from '../species/humanoid/bones';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** What a tracked person follows: its head (the eyes' middle, turned as the head is) and its hands (the wrists), each a target. */
export interface Tracked {
  head?: Target;
  left?: Target;
  right?: Target;
}

/**
 * A person following tracked poses (a headset and controllers, `Object3D`s as XR gives them, or any targets): the head goes where its
 * target is, turned as it is, the spine bending under it and the feet stepping round and under it; each hand keeps to its target, turned
 * as it is, as briskly as a hand keeps to what it holds (`HOLD`: a controller is where the hand is). An aimer, it keeps on until `until`.
 * It asks for the eyes, the legs and the trunk with a head, and for each hand it is given.
 */
export function track(body: Body, tracked: Tracked, options: { until?: Until } = {}): Verb {
  return verb(body, 'track', (request) => function* () {
    const person = personOf(selfOf(body)), branches = [];
    if (tracked.head) {
      const head = heading(person, finder(person, tracked.head));
      branches.push(during(request, 'go', 'asked', head.under), during(request, 'look', 'asked', head.look));
    }
    for (const side of ['left', 'right'] as const satisfies readonly Side[]) {
      const target = tracked[side];
      if (!target) continue;
      branches.push(during(request, `hand.${side}`, 'asked', reaching(person, side, finder(person, target), { ...HOLD, lead: false })));
    }
    yield* parallel('all', ...branches);
  }, options.until, true);
}
