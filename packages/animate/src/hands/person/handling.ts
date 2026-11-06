import { action } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { paceAt, type Handling } from '../handling';
import { CALM } from './arms';
import { bodyOf } from '../../things/hold';
import { sideOf } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { grabbing, takingAtOnce } from './grab';
import { carrying, liftingClear } from './carry';
import { wayOf } from '../route';
import { reachingTo } from './reach';
import { backingOut } from './release';
import { goalOn, palmOn } from './palm';

/** the longest a grab waits, its hands on their grips, for their fingers to close (s) */
const CLOSING = 0.3;

/** Human hand staging; the right hand leads coordinated reaches. */
export function personHands(person: Reacher): Handling {
  return {
    take: function* (request, thing, grips, options) {
      const loose = thing.massive && !bodyOf(thing.object);
      const takes = grips.map(({ hand, grip }) => {
        const side = sideOf(hand), palm = palmOn(person, side, thing, thing.grip(grip));
        return { side, thing, grip, goal: goalOn(thing.grip(grip), palm), palm };
      });
      // (each hand shapes for its grip as it comes, until it holds it)
      for (const { side, grip } of takes) person.fingers?.toward(side, thing.grip(grip).node);
      try {
        if (options.speed === Infinity) {
          yield* takingAtOnce(person, request, takes);
          return request.met();
        }
        const motion = options.speed === undefined ? undefined : paceAt(options.speed, CALM);
        if (!(yield* grabbing(person, request, takes, options.step ?? true, motion))) return;
        // (held once the fingers have closed on it: taken away as the hand arrives, a thing would leave before the grasp holds it)
        const fingers = person.fingers, began = person.frame.time;
        if (fingers) yield* action<Frame>({ until: (f) => f.time - began >= CLOSING || takes.every(({ side }) => fingers.closed(side)) });
        if (loose) yield* liftingClear(person, request, thing);
        request.met();
      } finally {
        for (const { side } of takes) person.fingers?.toward(side, null);
      }
    },
    bring: (request, thing, points, end, options) => carrying(person, request, thing, wayOf(person, thing, points, end), options),
    reach: (request, aims, options) => reachingTo(person, request, aims.map(({ hand, target }) => ({ side: sideOf(hand), target })), options),
    backOut(hands, away) {
      const sides = hands.map(sideOf);
      person.own('release', '', (request) => () => backingOut(person, request, sides.map((side) => ({ side, away: away[side] ?? null }))));
    },
  };
}
