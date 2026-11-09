import { selfOf, type Body } from '../body';
import { handTarget, type Target } from '../things/target';
import { verb, type Until, type Verb } from './story';

/** What a tracked person follows: its head (the eyes' middle, turned as the head is) and its hands (the wrists), each a target. */
export type Tracked = Partial<Record<'head' | 'left' | 'right', Target>>;

/**
 * A person following tracked poses (a headset and controllers, `Object3D`s as XR gives them, or any targets): the head goes where its
 * target is, turned as it is, the spine bending under it and the feet stepping round and under it; each hand keeps to its target, turned
 * as it is, as briskly as a hand keeps to what it holds (`HOLD`: a controller is where the hand is), within its arm's reach of the
 * shoulder (`species.person.armLength`, beside `shoulderHeight` and the other measures: place scripted targets from them, not in metres).
 * Scripted targets make gestures that must follow a path at once (a clap, a fist pump); for one an arm's angles describe (raised, spread,
 * a wave), `pose`'s `arms` is simpler. An aimer, it keeps on until `until`; ended, each hand goes back to its hang, clear of the trunk.
 * It asks for the eyes, the legs and the trunk with a head, and for each hand it is given.
 */
export function track(body: Body, tracked: Tracked, options: { until?: Until } = {}): Verb {
  for (const target of [tracked.left, tracked.right]) if (target) handTarget(target, 'track');
  return verb(body, 'track', (request) => () => selfOf(body).person.tracking(request, tracked), { until: options.until, aimer: true });
}
