import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { approach, closeHand, handTo, hold, INDEX, lookAt, onBone, reached, reachFor, still, wear, type Behaviour, type Frame, type Holds, type Item, type World } from '@drawcall/animate';
import { reported } from '../../report';
import { along, at, busy, eyesOn, pause, type Knight } from './knight';

type F = Frame<World>;

/** where the helm sits on the head (its middle in the head's frame: round the skull, a finger's breadth all round) */
export const HELMED = at(0, 0.15, 0.02, new Quaternion());

/**
 * The helm: taken off its stand in both hands (facing as its grips say), lifted before the face (a
 * look into it), raised over the head and lowered onto it slowly, the head bowed a little to take
 * it (the eyes ahead and down); worn on the head, settling onto it; the hands go to its chin
 * strap's ends and buckle it under the chin; they let go as the next thing sets off (`flow`).
 */
export function putOnHelmet(k: Knight, helmet: Item): Behaviour<World> {
  // (before the face and over the head in a level frame at the head: the eyes on the helmet turn the head, which must not turn where it goes)
  const level = INDEX.head;
  const head = [k.h, INDEX.head] as const;
  const down = onBone(k.h, INDEX.hips, at(0, 0.15, 1.6), { facing: true });
  return function* () {
    // (its grips are toward its front, away from him: he stands back from them)
    const hands: Holds = { left: [helmet, 'left'], right: [helmet, 'right'] };
    yield* approach(k.h, hands, { stand: { ahead: 'reach' } })();
    // Reach around the sides of the crown, with the elbows outside the helmet.
    const there = (f: F) => (['left', 'right'] as const).every((side) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], helmet.grips[side], helmet));
    yield* busy(k, eyesOn(k, () => helmet.current.position, () => parallel<F>('all', ...(['left', 'right'] as const).map((side) => handTo(k.h, side, helmet.grips[side], {
      on: helmet, seconds: 0.9 / k.pace, until: there,
      // 0.45 m out keeps the forearms clear of the helmet rim as the hands close on the grips.
      pole: () => new Vector3(side === 'left' ? 0.45 : -0.45, -0.3, -0.1).applyQuaternion(helmet.current.quaternion).add(helmet.current.position),
    })))))();
    for (const side of ['left', 'right'] as const) yield* closeHand(k.h, side, helmet, side)();
    yield* eyesOn(k, () => helmet.current.position, along(k, helmet, [[1.0, at(0, 0.14, 0.3, new Quaternion())], [0.4, still]], { on: level }), { first: false })();
    yield* along(k, helmet, [[0.7, at(0, 0.42, 0.26)], [0.6, at(0, 0.4, 0.02)]], { on: level })();
    yield* parallel<F>('race', along(k, helmet, [[1.2, HELMED]], { on: head }), lookAt(k.h.gazer, reported(k.report, 'gaze', (f) => down(f).position)));
    yield* wear(k.h, helmet, INDEX.head, { to: HELMED })();
    // (the chin strap: its ends from by the jaw, buckled under the chin, a tug)
    yield* busy(k, function* () {
      yield* reachFor(k.h, { left: [helmet, 'strapLeft'], right: [helmet, 'strapRight'] })();
      yield* reachFor(k.h, { left: [helmet, 'chinLeft'], right: [helmet, 'chinRight'] })();
      yield* parallel<F>('race', pause(k, 0.6), hold(k.h, helmet));
    })();
  };
}
