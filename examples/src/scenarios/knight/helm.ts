import { Quaternion, Vector3 } from 'three';
import { parallel, timePassed } from '@pmndrs/timeline';
import { grab, handTo, hold, INDEX, lookAt, facingAt, still, wear, when, type Behaviour, type Frame, type Grips, type Item } from '@drawcall/animate';
import { ARM_REACH, approach, reached } from '@drawcall/animate/rig';
import { reported } from '../../report';
import { along, at, busy, eyesOn, pause, type Knight } from './knight';

type F = Frame;

/** where the helm sits on the head (its middle in the head's frame: round the skull, a finger's breadth all round) */
export const HELMED = at(0, 0.15, 0.02, new Quaternion());

/**
 * The helm: taken off its stand in both hands (facing as its grips say), lifted before the face (a
 * look into it), raised over the head and lowered onto it slowly, the head bowed a little to take
 * it (the eyes ahead and down); worn on the head, settling onto it; the hands go to its chin
 * strap's ends and buckle it under the chin; they let go as the next thing sets off (`flow`).
 */
export function putOnHelmet(k: Knight, helmet: Item): Behaviour {
  // A level frame at the head keeps its turn independent of the gaze.
  const level = facingAt(k.h, INDEX.head, { position: new Vector3() });
  const down = facingAt(k.h, INDEX.hips, at(0, 0.15, 1.6));
  return function* () {
    // (its grips are toward its front, away from him: he stands back from them)
    const hands: Grips = { left: [helmet, 'left'], right: [helmet, 'right'] };
    yield* approach(k.h, hands, { spot: { ahead: ARM_REACH * k.h.proportions.armLength } })();
    // Reach around the sides of the crown, with the elbows outside the helmet.
    const there = (f: F) => (['left', 'right'] as const).every((side) => reached(f, INDEX[`${side}Hand`], helmet.grips[side], helmet));
    yield* busy(k, eyesOn(k, () => helmet.current.position, () => parallel<F>('all', ...(['left', 'right'] as const).map((side) => handTo(k.h, side, helmet.grips[side], {
      on: helmet, seconds: 0.9 / k.pace, until: there,
      // 0.45 m out keeps the forearms clear of the helmet rim as the hands close on the grips.
      pole: () => new Vector3(side === 'left' ? 0.45 : -0.45, -0.3, -0.1).applyQuaternion(helmet.current.quaternion).add(helmet.current.position),
    }))), { first: true }))();
    yield* grab(k.h, { left: [helmet, 'left'], right: [helmet, 'right'] }, { walk: false, look: false })();
    yield* eyesOn(k, () => helmet.current.position, along(k, helmet, [[1.0, at(0, 0.14, 0.3, new Quaternion())], [0.4, still]], { frame: level }))();
    yield* along(k, helmet, [[0.7, at(0, 0.42, 0.26)], [0.6, at(0, 0.4, 0.02)]], { frame: level })();
    yield* wear(k.h, helmet, INDEX.head, { to: HELMED })();
    yield* parallel<F>('race', () => when(timePassed(1.2 / k.pace, 'seconds')), lookAt(k.h, reported(k.report, 'gaze', (f) => down(f).position)));
    // (the chin strap: its ends from by the jaw, buckled under the chin, a tug)
    yield* busy(k, function* () {
      yield* grab(k.h, { left: [helmet, 'strapLeft'], right: [helmet, 'strapRight'] }, { walk: false, look: false })();
      yield* grab(k.h, { left: [helmet, 'chinLeft'], right: [helmet, 'chinRight'] }, { walk: false, look: false })();
      yield* parallel<F>('race', pause(k, 0.6), hold(k.h, helmet));
    })();
  };
}
