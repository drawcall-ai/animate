import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { selfOf, type Body } from '../body/body';
import { personOf } from '../body/person';
import { heading } from '../look/head';
import { HOLD, reaching } from '../hands/person/arms';
import { INDEX, type Side } from '../species/humanoid/bones';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** how far a tracked hand may be off a target past `reach` × its arm's length (m, default body) — as far as a reach is let end — and how
 * long (s) it may come no nearer by `closing` (m) before it is said */
const OFF = { distance: 0.02, reach: 0.98, seconds: 0.5, closing: 0.002 };

/** What a tracked person follows: its head (the eyes' middle, turned as the head is) and its hands (the wrists), each a target. */
export type Tracked = Partial<Record<'head' | Side, Target>>;

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
      const find = finder(person, target), keep = reaching(person, side, find, { ...HOLD, lead: false });
      // (development: a hand `OFF.distance` off where its target was a sub-step before, the target past the arm held out straight from
      // the shoulder, and no nearer it for `OFF.seconds` is said once, as a reach that falls short is; a hand lagging a target in reach
      // is not)
      let since = 0, nearest = Infinity, said = false;
      const shoulder = INDEX[`${side}UpperArm`];
      let last: Vector3 | null = null;
      branches.push(during(request, `hand.${side}`, 'asked', (f) => {
        if (f.dev && !said && last) {
          const gap = f.prev.position(person.hands[side]).distanceTo(last);
          const beyond = f.prev.position(shoulder).distanceTo(last) > OFF.reach * person.proportions.armLength;
          if (!beyond || gap <= OFF.distance * person.scale || gap < nearest - OFF.closing * person.scale) [since, nearest] = [f.time, gap];
          if (f.time - since > OFF.seconds) {
            said = true;
            f.dev.append(f.time, { check: 'tracked hand short of a target out of reach (m)', value: gap, limit: OFF.distance * person.scale, where: side });
          }
        }
        keep(f);
        (last ??= new Vector3()).copy(find(f).position);
      }));
    }
    yield* parallel('all', ...branches);
  }, options.until, true);
}
