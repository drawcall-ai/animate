import type { Handling } from '../handling';
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
    take: function* (request, thing, grips, manner) {
      const loose = thing.massive && !bodyOf(thing.object);
      const takes = grips.map(({ hand, grip }) => ({ side: sideOf(hand), thing, grip, goal: goalOn(thing.grip(grip), person.restOf(person.hands[hand])) }));
      if (manner.speed === Infinity) {
        yield* takingAtOnce(person, request, takes);
        return request.met();
      }
      const motion = manner.speed === undefined ? undefined : { speed: manner.speed, accel: manner.accel };
      if (!(yield* grabbing(person, request, takes, manner.step ?? true, motion))) return;
      if (loose) yield* liftingClear(person, request, thing);
      request.met();
    },
    bring: (request, thing, points, end, manner) => carrying(person, request, thing, wayOf(person, thing, points, end), manner),
    reach: (request, aims, manner) => reachingTo(person, request, aims.map(({ hand, target }) => ({ side: sideOf(hand), target })), manner),
    backOut(hands) {
      const sides = hands.map(sideOf);
      person.own('release', '', (request) => () => backingOut(person, request, sides));
    },
  };
}
