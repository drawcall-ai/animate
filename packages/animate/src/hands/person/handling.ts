import { Quaternion } from 'three';
import { paceAt, type Handling } from '../handling';
import { CALM } from './arms';
import { bodyOf, goalOn, type Palm } from '../../things/hold';
import type { Grip, Thing } from '../../things/thing';
import { sideOf, type Side } from '../../species/humanoid/bones';
import { palmOf } from '../../species/humanoid/landmarks';
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
      const takes = grips.map(({ hand, grip }) => {
        const side = sideOf(hand), at = thing.grip(grip), hold = palm(person, side, thing, at);
        return { side, thing, grip, goal: goalOn(at, person.restOf(person.hands[hand]), hold), palm: hold };
      });
      // (each hand opens as it comes, until it holds its grip)
      for (const { side } of takes) person.fingers?.toward(side, true);
      try {
        if (options.speed === Infinity) {
          yield* takingAtOnce(person, request, takes);
          return request.met();
        }
        const motion = options.speed === undefined ? undefined : paceAt(options.speed, CALM);
        if (!(yield* grabbing(person, request, takes, options.step ?? true, motion))) return;
        if (loose) yield* liftingClear(person, request, thing);
        request.met();
      } finally {
        for (const { side } of takes) person.fingers?.toward(side, false);
      }
    },
    bring: (request, thing, points, end, options) => carrying(person, request, thing, wayOf(person, thing, points, end), options),
    reach: (request, aims, options) => reachingTo(person, request, aims.map(({ hand, target }) => ({ side: sideOf(hand), target })), options),
    backOut(hands) {
      const sides = hands.map(sideOf);
      person.own('release', '', (request) => () => backingOut(person, request, sides));
    },
  };
}

/**
 * `side`'s palm on `grip` of `thing`: its centre beyond the wrist — on a handle, for a hand with fingers, where the handle lies in its
 * grasp — and the hand's turn in the thing's frame as the body was last posed (mid-update, the hand's turn may be the free arm's hang's,
 * written before the hand's own step: a reach read so never met its grip)
 */
function palm(person: Reacher, side: Side, thing: Thing, grip: Grip): Palm {
  const bone = person.hands[side], turn = new Quaternion();
  const turned = () => turn.copy(person.track(thing.object).at(person.frame.time).prev.quaternion).invert().multiply(person.frame.prev.rotation(bone));
  const fingers = person.fingers;
  if (!grip.handle || !fingers) return { at: palmOf(person.proportions, side), turn: turned };
  // (the hand's grasp, measured in its node's frame, in its bone's)
  // (the handle's radius, the world's, in the hand's units)
  const scale = person.scaleOf(bone), { at, axis, facing } = fingers.joints(side).handleLine(grip.handle.radius / scale), rest = person.restOf(bone);
  return { at: at.applyQuaternion(rest).multiplyScalar(scale), turn: turned, line: { axis: axis.applyQuaternion(rest), facing: facing.applyQuaternion(rest) } };
}
