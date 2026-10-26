import { Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { selfOf, type Body, type HandOf } from '../body/body';
import { during } from '../body/requests';
import type { Frame } from '../core/frame';
import type { Target as Goal } from '../core/goal';
import type { AnySpecies } from '../core/species';
import { looking, SHIFT } from '../core/gaze';
import { reached } from '../core/tip';
import { seedOf } from '../core/random';
import { nuzzling } from '../core/hands';
import { Person, sideOf } from '../humanoid/person';
import { ARM_REACH, CALM, reaching } from '../humanoid/arms';
import { INDEX } from '../humanoid/bones';
import { reachTime } from '../humanoid/hands/reach';
import { standing, walking } from '../humanoid/hands/stand';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a reach goes. */
export interface ReachOptions {
  /** the hand's speed (m/s; default the time a calm reach that far takes, Fitts') */
  speed?: number;
  /** its acceleration with `speed` (m/s²) */
  accel?: number;
  /** ends on this instead of arriving: a target that moves is followed until then */
  until?: Until;
}

/**
 * Reaches each hand named to its target (an `Object3D` turns the hand as it is turned), taking nothing: from where it stands if the arms
 * reach them, else it walks up first (borrowed legs), its eyes on the targets (borrowed), the hands going as it arrives (asked), the body
 * turning, bowing, bending or rising on its toes for them. A mover, it ends once the hands are there and keeps them there. It returns `false` if it can stand nowhere in reach.
 */
export function reach<S extends AnySpecies>(body: Body<S>, targets: Partial<Record<HandOf<S>, Target>>, options: ReachOptions = {}): Verb {
  const named = Object.entries<Target | undefined>(targets).flatMap(([hand, target]) => target === undefined ? [] : [{ hand, target }]);
  if (!named.length) throw new Error('reach: name a target for a hand');
  return verb(body, 'reach', (request) => function* () {
    const self = selfOf(body);
    if (!(self instanceof Person)) {
      if (named.length > 1) throw new Error('reach: a creature reaches with one hand at a time');
      const find = finder(self, named[0].target);
      yield* nuzzling(self, request, named[0].hand, (f) => find(f).position);
      return;
    }
    const h = self, hands = named.map(({ hand, target }) => ({ side: sideOf(hand), find: finder(h, target) }));
    const goal = (find: ReturnType<typeof finder>) => (f: Frame): Goal => {
      const found = find(f);
      return { position: found.position, quaternion: found.quaternion ?? undefined, velocity: found.velocity };
    };
    // (targets the arms reach from where it stands are reached from there, the trunk turning — its shoulder up to its half-width nearer —
    // and bowing for them)
    const most = ARM_REACH * h.proportions.armLength + h.proportions.shoulderHalfWidth;
    const inReach = hands.every(({ side, find }) => h.pose.position(INDEX[`${side}UpperArm`]).distanceTo(find(h.frame).position) < most);
    const plan = inReach ? 'there' : standing(h, { grips: hands.map(({ side, find }) => ({ side, at: find(h.frame).position.clone() })), mass: 0 });
    if (plan === 'nowhere') {
      request.fail();
      return;
    }
    let stood = plan === 'there';
    const near = () => stood || (plan !== 'there' && plan.walk.eta <= NEAR);
    const middle = (f: Frame) => hands.reduce((sum, { find }) => sum.add(find(f).position), _middle.set(0, 0, 0)).divideScalar(hands.length);
    const there = (f: Frame) => hands.every(({ side, find }) => reached(f, h.hands[side], goal(find)(f)));
    const going = hands.map(({ side, find }) => {
      const distance = h.pose.position(h.hands[side]).distanceTo(find(h.frame).position);
      const { speed } = options, accel = options.accel ?? CALM.accel;
      if (speed !== undefined) return { side, step: reaching(h, side, goal(find), { accel, speed }), lasts: distance / speed + speed / accel };
      const seconds = reachTime(distance / h.scale, seedOf(side, Math.round(distance * 1000))) / h.tempo;
      return { side, step: reaching(h, side, goal(find), { seconds }), lasts: seconds };
    });
    // (what it moves arrives once the farthest hand does: the hands set off `NEAR` s before a walk arrives)
    const lasts = Math.max(...going.map((hand) => hand.lasts));
    let setOff = NaN;
    yield* parallel<Frame>('all', function* () {
      if (plan === 'there') return;
      if (!(yield* walking(request, plan, Math.max(0, lasts - NEAR)))) request.fail();
      stood = true;
    }, function* () {
      yield* parallel<Frame>('race', during(request, 'look', 'borrowed', looking(h, middle, SHIFT)), function* () {
        yield* action<Frame>({ until: near });
        const eta = (f: Frame) => void (request.eta = Math.max(0, (Number.isNaN(setOff) ? (setOff = f.time) : setOff) + lasts - f.time));
        yield* parallel<Frame>('race', ...going.map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)), action<Frame>({ update: eta, until: there }));
      });
    });
    if (request.outcome === 'failed') return;
    request.met();
    // (there, it keeps its hands there till its story moves on)
    yield* parallel<Frame>('all', ...going.map(({ side, step }) => during(request, `hand.${side}`, 'asked', step)));
  }, options.until);
}

/** the hands set off once the walk will arrive within this (s) */
const NEAR = 0.6;
const _middle = new Vector3();
