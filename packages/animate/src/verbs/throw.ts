import type { Object3D } from 'three';
import { selfOf, type Body } from '../body';
import type { Released } from '../body/letgo';
import { handsOn } from '../things/hold';
import type { Target } from '../things/target';
import { Thing } from '../things/thing';
import { verb, type Verb } from './story';

/** How a throw goes. */
export interface ThrowOptions {
  /** the speed it leaves the hand at (m/s; default the least that carries it to the target on a 40° arc, at most 25): what `released`
   * reports, aimed at the target — out of reach at that speed, at 45°, as far as it goes, and the throw misses */
  speed?: number;
  /** the gravity your physics flies it under (m/s², down; default 9.81): what the aim at the target is worked out for */
  gravity?: number;
  /** called as the thing leaves the hand, ahead of the head on its way down, with how it is moving: the velocity aimed at the target
   * (or as the hand moved it, with no target) and the spin the hand gave it — give them to your physics. The thing is already let go:
   * attached under the scene's root where it is, its transform the world's */
  released?: (motion: Released) => void;
}

/**
 * Throws `thing`, held in one of a person's hands, overhand at `target` (a point, an object or a function of the body's time giving either, read as the thing is
 * let go; none: straight ahead), along the way the
 * body faces — turn it toward the target first. The hand swings out to the side and cocks the thing behind the ear at head height as the
 * trunk coils away, the hips with it, and the body sinks onto its back foot, the free arm pointing at the target; the hips and then the
 * trunk uncoil ahead of the arm and
 * the weight drives forward as the hand whips past the side of the head, the elbow up, and lets go ahead of it with the arm a little above
 * level; the hand follows through down past the other hip, the free arm pulled in. Every place is the body's own,
 * scaled to it. The thing is left in the world where it was let go (`release`); its flight is your physics', from what `released` is
 * given. Standing, the foot on the free side strides half a step ahead through the throw, and steps back after; walking or running, it
 * throws over its own gait, the hips left to it. It asks for the throwing hand, the
 * free arm (when its hand holds nothing) and the trunk, which it takes from a `lookAt` given `trunk` (a look without one keeps the eyes
 * beside it). A mover, it ends `true` once the follow-through is done (about 1 s after it starts): the throwing arm is free for the next
 * hand verb (taking a weapon back), and the trunk and the stride come back on their own meanwhile. A target out of reach at its speed
 * throws `Missed` after the follow-through, the thing already gone as `released` was told. It says only whether the aim reaches the target:
 * the flight is your physics'.
 */
export function throwAt(body: Body, thing: Object3D, target?: Target, options: ThrowOptions = {}): Verb {
  const self = selfOf(body), held = Thing.of(thing), hands = handsOn(self, held);
  if (!body.species.person) throw new Error(`throwAt: a ${body.species.name ?? 'custom species'} has no arms to throw with`);
  if (hands.length !== 1) throw new Error(`throwAt: "${thing.name}" is held in ${hands.length} hands; throw what one hand holds`);
  const person = self.person;
  return verb(body, 'throwAt', (request) => () => person.throwing(request, held, hands[0], target, options));
}
