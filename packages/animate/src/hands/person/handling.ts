import type { Handling } from '../handling';
import { bodyOf, goalOn } from '../../things/hold';
import { sideOf } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';
import { grabbing } from './grab';
import { carrying, liftingClear, wayOf } from './carry';
import { reachingTo } from './reach';
import { backingOut } from './release';

/**
 * A person's hands for the verbs: both at once, the right leading — taking things walked up to with the eyes first and the hands rising
 * before it arrives, carrying them by their approaches (walking there with them at the body if it must), reaching, backing out.
 */
export function personHands(person: Reacher): Handling {
  return {
    take: function* (request, thing, grips, pace) {
      const loose = thing.massive && !bodyOf(thing.object);
      const takes = grips.map(({ hand, grip }) => ({ side: sideOf(hand), thing, grip, goal: goalOn(thing.grip(grip), person.restOf(person.hands[hand])) }));
      if (!(yield* grabbing(person, request, takes, pace.speed === undefined ? undefined : { speed: pace.speed, accel: pace.accel }))) return;
      if (loose) yield* liftingClear(person, request, thing);
      request.met();
    },
    bring: function* (request, thing, points, end, pace) {
      yield* carrying(person, request, thing, wayOf(person, thing, points, end), pace);
    },
    reach: function* (request, aims, pace) {
      yield* reachingTo(person, request, aims.map(({ hand, target }) => ({ side: sideOf(hand), target })), pace);
    },
    backOut(hands) {
      const sides = hands.map(sideOf);
      person.own('release', '', (request) => () => backingOut(person, request, sides));
    },
  };
}
