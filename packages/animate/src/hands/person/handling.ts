import { Quaternion, Vector3 } from 'three';
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
      // (each hand shapes for its grip as it comes, until it holds it)
      for (const { side, grip } of takes) person.fingers?.toward(side, thing.grip(grip).node);
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

/**
 * `side`'s palm on `grip` of `thing`: the point of the hand that goes on the empty — for a hand with fingers, where it holds the grip
 * (`HandPoint`), else the palm's centre beyond the wrist — and the hand's turn in the thing's frame as the body was last posed (mid-update,
 * the hand's turn may be the free arm's hang's, written before the hand's own step: a reach read so never met its grip)
 */
function palm(person: Reacher, side: Side, thing: Thing, grip: Grip): Palm {
  const bone = person.hands[side], turn = new Quaternion();
  const turned = () => turn.copy(person.track(thing.object).at(person.frame.time).prev.quaternion).invert().multiply(person.frame.prev.rotation(bone));
  const fingers = person.fingers;
  if (!fingers) {
    // (where a hand holds a handle or a pad, and which way that faces, is its fingers': without them, its grip's own would be dropped)
    const key = grip.handle ? 'handle' : grip.pad ? 'pad' : grip.facing ? 'facing' : null;
    if (key) throw new Error(`"${grip.node.name}" has userData.${key}, which only a hand with finger bones holds by: this skeleton has none`);
    return { at: palmOf(person.proportions, side), turn: turned };
  }
  // (a hand with fingers is turned by what it touches, a handle's line, a palm's or pad's facing, not by the empty's axes: two ways to turn
  // one hand, one of them blind to where the fingers go)
  if (grip.turn !== null) throw new Error(`"${grip.node.name}" has userData.handTurn, which a hand with finger bones does not take: describe the grip as a handle, a pad or a palm's facing`);
  // (where the hand holds it, measured in its node's frame, in its bone's)
  const scale = person.scaleOf(bone), { at, axis, facing, palmFacing } = fingers.pointOn(side, grip), rest = person.restOf(bone);
  const point = { at: at.applyQuaternion(rest).multiplyScalar(scale), facing: facing.applyQuaternion(rest), axis: axis.applyQuaternion(rest), palmFacing: palmFacing.applyQuaternion(rest) };
  // (the world's up in the thing's frame, as the hand sets off for it)
  const up = new Vector3(0, 1, 0).applyQuaternion(person.track(thing.object).at(person.frame.time).prev.quaternion.clone().invert());
  return { at: point.at, turn: turned, point, up };
}
