import { parallel } from '@pmndrs/timeline';
import { during } from '../body/requests';
import { selfOf, type Body } from '../body/body';
import type { Frame } from '../core/frame';
import type { Target as Goal } from '../core/goal';
import { personOf } from '../humanoid/person';
import { heading } from '../humanoid/head';
import { reaching } from '../humanoid/arms';
import type { Side } from '../humanoid/bones';
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
 * target is, turned as it is, the spine bending under it and the feet stepping round and under it; each hand goes to its target, turned
 * as it is. An aimer, it keeps on until `until`. It asks for the eyes, the legs and the trunk with a head, and for each hand it is given.
 */
export function track(body: Body, tracked: Tracked, options: { until?: Until } = {}): Verb {
  return verb(body, 'track', (request) => function* () {
    const h = personOf(selfOf(body)), branches = [];
    if (tracked.head) {
      const find = finder(h, tracked.head);
      const head = heading(h, (f) => {
        const found = find(f);
        return { position: found.position, quaternion: found.quaternion ?? undefined };
      });
      branches.push(during(request, 'go', 'asked', head.under), during(request, 'look', 'asked', head.look));
    }
    for (const side of ['left', 'right'] as const satisfies readonly Side[]) {
      const target = tracked[side];
      if (!target) continue;
      const find = finder(h, target);
      const goal = (f: Frame): Goal => {
        const found = find(f);
        return { position: found.position, quaternion: found.quaternion ?? undefined, velocity: found.velocity };
      };
      branches.push(during(request, `hand.${side}`, 'asked', reaching(h, side, goal, { lead: false })));
    }
    yield* parallel('all', ...branches);
  }, options.until, true);
}
