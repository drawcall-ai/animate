import { Quaternion, Vector3 } from 'three';
import { Item } from '../../core/carrier';
import type { Holds } from '../../core/hands';
import type { Body } from '../../core/body';
import { withGaze } from '../../core/gaze';
import { live, type Behaviour, type Live } from '../../core/goal';
import { nuzzle } from '../../core/hands';
import { handTo } from '../arms';
import { INDEX, type Side } from '../bones';
import type { Frame } from '../../core/body';
import { isPerson } from '../humanoid';
import { approach } from './grab';

/** Tuned: a touch is made with the hand's wrist this near what it touches (m, × the body's scale): the palm's length, roughly */
const PALM = 0.04;

/**
 * Touching `target` with the hand `hand`, taking nothing: the body walks up to stand with it in reach (bowing and lowering if it is low;
 * a creature lets its body down and tips its front for what its neck does not reach), its eyes on it, and ends once the hand is there;
 * the base then takes the hand back. Out of its reach from anywhere it could stand, that is a problem in the dev log and it stands.
 */
export function touch<H extends string>(body: Body<H>, hand: H, target: Live<Vector3>): Behaviour {
  if (!isPerson(body)) return nuzzle(body, hand, target);
  const side = hand as string as Side;
  return function* () {
    // (standing to it as to a grip there for that hand: it in that hand's comfortable reach)
    const at = live(target, body.frame).clone(), spot = new Item(at, new Quaternion(), { touched: { position: new Vector3() } }, { name: 'touched' });
    yield* approach(body, { [side]: [spot, 'touched'] } as Holds<Side>)();
    // (there once the hand is within a palm of it: the wrist goes for it, the palm and fingers meet it)
    const hand = INDEX[`${side}Hand`], there = (f: Frame) => f.prev.position(hand).distanceTo(live(target, f)) < PALM * body.scale;
    yield* withGaze(body, target, handTo(body, side, (f) => ({ position: live(target, f) }), { until: there }))();
  };
}
