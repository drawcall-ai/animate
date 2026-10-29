import { paceAt, type Handling } from '../handling';
import { CALM } from './arms';
import { bodyOf, goalOn } from '../../things/hold';
import { sideOf } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { grabbing, takingAtOnce } from './grab';
import { carrying, liftingClear } from './carry';
import { wayOf } from '../route';
import { reachingTo } from './reach';
import { backingOut } from './release';

/** Human hand staging; the right hand leads coordinated reaches. */
export function personHands(person: Reacher): Handling {
  return {
    take: function* (request, thing, grips, options) {
      const loose = thing.massive && !bodyOf(thing.object);
      const takes = grips.map(({ hand, grip }) => ({ side: sideOf(hand), thing, grip, goal: goalOn(thing.grip(grip), person.restOf(person.hands[hand])) }));
      if (options.speed === Infinity) {
        yield* takingAtOnce(person, request, takes);
        return request.met();
      }
      const motion = options.speed === undefined ? undefined : paceAt(options.speed, CALM);
      if (!(yield* grabbing(person, request, takes, options.step ?? true, motion))) return;
      if (loose) yield* liftingClear(person, request, thing);
      request.met();
    },
    bring: (request, thing, points, end, options) => carrying(person, request, thing, wayOf(person, thing, points, end), options),
    reach: (request, aims, options) => reachingTo(person, request, aims.map(({ hand, target }) => ({ side: sideOf(hand), target })), options),
    backOut(hands) {
      const sides = hands.map(sideOf);
      person.own('release', '', (request) => () => backingOut(person, request, sides));
    },
  };
}
