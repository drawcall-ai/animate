import { action } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { paceAt, type Handling } from '../handling';
import { CALM } from './arms';
import { bodyOf } from '../../things/hold';
import { sideOf } from '../../species/humanoid/bones';
import { grabbing, grabAtOnce } from './grab';
import { carrying, liftingClear } from './carry';
import { wayOf } from '../route';
import { reachingTo } from './reach';
import { backingOut } from './release';
import { settling, takingOf } from './take';
import type { Person } from '../../body/person';

/** the longest a grab waits, its hands on their grips, for their fingers to close (s) */
const CLOSING = 0.2;

/** Human hand staging; the right hand leads coordinated reaches. */
export function personHands(person: Person): Handling {
  return {
    take: function* (request, thing, grips, options) {
      const loose = thing.massive && !bodyOf(thing.object);
      // (each hand's placement picked as the grab starts, from where the body stands, and kept on the thing while it holds it)
      const takes = grips.map(({ hand, grip }) => takingOf(person, sideOf(hand), thing, grip));
      // (each hand on its way to its take, its fingers shaping for its placement as it comes, until it holds it)
      for (const take of takes) {
        person.coming[take.side] = take;
        person.fingers?.toward(take.side, take.placement);
      }
      try {
        if (options.speed === Infinity) {
          yield* grabAtOnce(person, request, takes);
          return request.met();
        }
        const motion = options.speed === undefined ? undefined : paceAt(options.speed, CALM);
        if (!(yield* grabbing(person, request, takes, options.step ?? true, motion))) return;
        // (held once the fingers have closed on it: taken away as the hand arrives, a thing would leave before the grasp holds it)
        const fingers = person.fingers, began = person.frame.time;
        if (fingers) yield* action<Frame>({ until: (f) => f.time - began >= CLOSING || takes.every(({ side }) => fingers.closed(side)) });
        yield* settling(person, request, takes, began);
        if (loose) yield* liftingClear(person, request, thing);
        request.met();
      } finally {
        for (const { side } of takes) {
          person.coming[side] = null;
          person.fingers?.toward(side, null);
        }
      }
    },
    bring: (request, thing, points, end, options) => carrying(person, request, thing, wayOf(person, thing, points, end), options),
    reach: (request, targets, options) => reachingTo(person, request, targets.map(({ hand, target }) => ({ side: sideOf(hand), target })), options),
    backOut(hands, away) {
      const sides = hands.map(sideOf);
      person.own('release', '', (request) => () => backingOut(person, request, sides.map((side) => ({ side, away: away[side] ?? null }))));
    },
  };
}
