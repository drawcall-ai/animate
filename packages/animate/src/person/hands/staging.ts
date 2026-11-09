import { action } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { paceAt, type HandStaging } from '../../body/hand-staging';
import { CALM } from './arms';
import { bodyOf, inHand, take } from '../../things/hold';
import { sideOf } from '../anatomy/bones';
import { grabbing } from './grab';
import { carrying, liftingClear } from './carry';
import { carryPathOf } from '../../things/carry-path';
import { reachingTo } from './reach';
import { backOff } from './press';
import { backingOut } from './release';
import { settling, handPlanOf } from './plan';
import type { Person } from '../person';

/** the longest a grab waits, its hands on their grips, for their fingers to close (s) */
const CLOSING = 0.2;

/** A person's hand staging; the right hand leads coordinated reaches. */
export function personHands(person: Person): HandStaging {
  return {
    take: function* (request, thing, grips, options) {
      const loose = thing.massive && !bodyOf(thing.object);
      // (each hand's placement picked as the grab starts, from where the body stands, and kept on the thing while it holds it)
      const takes = grips.map(({ hand, grip }) => handPlanOf(person, sideOf(hand), thing, grip));
      // (each hand on its way to its take, its fingers shaping for its placement as it comes, until it holds it)
      for (const take of takes) {
        person.coming[take.side] = take;
        person.fingers?.toward(take.side, take.placement);
      }
      try {
        const motion = options.speed === undefined ? undefined : paceAt(options.speed, CALM);
        if (!(yield* grabbing(person, request, takes, options.step ?? true, motion))) return;
        // (held once the fingers have closed on it: taken away as the hand arrives, a thing would leave before the grasp holds it)
        const fingers = person.fingers, began = person.frame.time;
        if (fingers) yield* action<Frame>({ until: (f) => f.time - began >= CLOSING || takes.every(({ side }) => fingers.closed(side)) });
        yield* settling(person, request, takes, began);
        // (the second hand on what hung from the first: in both hands now, as if taken so)
        if (inHand(person, thing)) take(person, thing);
        if (loose) yield* liftingClear(person, request, thing);
        request.met();
      } finally {
        for (const { side } of takes) {
          person.coming[side] = null;
          person.fingers?.toward(side, null);
        }
      }
    },
    bring: (request, thing, points, end, options) => carrying(person, request, thing, carryPathOf(person, thing, points, end), options),
    reach: (request, targets, options) => reachingTo(person, request, targets.map(({ hand, target }) => ({ side: sideOf(hand), target })), options),
    away(hold, placed) {
      return backOff(person, hold.thing.grip(hold.grip), placed);
    },
    backOut(hands, away) {
      const sides = hands.map(sideOf);
      person.file('release', '', (request) => () => backingOut(person, request, sides.map((side) => ({ side, away: away[side] ?? null }))), 'own');
    },
  };
}
