import { Quaternion } from 'three';
import { parallel } from '@pmndrs/timeline';
import { hold, INDEX, lookAt, onBone, reachFor, still, wear, type Behaviour, type Frame, type Item, type World } from '@drawcall/animate';
import { reported } from '../../report';
import { along, at, busy, eyesOn, facingAt, ORIGIN, pause, take, type Knight } from './knight';

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
  const grips = { left: 'left', right: 'right' };
  // (before the face and over the head in a level frame at the head: the eyes on the helmet turn the head, which must not turn where it goes)
  const level = facingAt(k, 'head');
  const head = onBone(k.h, INDEX.head, ORIGIN);
  const down = onBone(k.h, INDEX.hips, at(0, 0.15, 1.6), { facing: true });
  return function* () {
    // (its grips are toward its front, away from him: he stands back from them)
    yield* take(k, { left: [helmet, 'left'], right: [helmet, 'right'] }, { stand: { ahead: 0.95 } })();
    yield* eyesOn(k, () => helmet.current.position, along(k, level, [[helmet, grips, [[1.0, at(0, 0.14, 0.3, new Quaternion())], [0.4, still]]]]), { first: false })();
    yield* along(k, level, [[helmet, grips, [[0.7, at(0, 0.42, 0.26)], [0.6, at(0, 0.4, 0.02)]]]])();
    yield* parallel<F>('race', along(k, head, [[helmet, grips, [[1.2, HELMED]]]]), lookAt(k.h.gazer, reported(k.report, 'gaze', (f) => down(f).position)));
    yield* wear(k.h, helmet, INDEX.head, { to: HELMED })();
    // (the chin strap: its ends from by the jaw, buckled under the chin, a tug)
    yield* busy(k, function* () {
      yield* reachFor(k.h, { left: [helmet, 'strapLeft'], right: [helmet, 'strapRight'] })();
      yield* reachFor(k.h, { left: [helmet, 'chinLeft'], right: [helmet, 'chinRight'] })();
      yield* parallel<F>('race', pause(k, 0.6), hold(k.h, helmet, { left: 'chinLeft', right: 'chinRight' }));
    })();
  };
}
