import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { carry, hold, INDEX, onBone, onItem, reachFor, release, takeOff, wear, yawOf, type Behaviour, type Frame, type Item, type Placement, type Stand, type World } from '@drawcall/animate';
import { course, still, type Leg } from './course';
import { along, at, busy, eyesOn, facingAt, ORIGIN, pause, SETTLE, take, turn, type Knight } from './knight';

// The sword belt and the sword: buckled on, hung at the left hip, its draw checked.

type F = Frame<World>;

/**
 * The sword belt: its two ends taken off the table, lifted and carried out round the hips (the
 * strap swung behind them), drawn round to before the belly, the tongue put through the buckle and
 * pulled tight there, the eyes on it (bowed as far as lets them see it); then worn on the hips.
 */
export function buckle(k: Knight, belt: { buckle: Item; tongue: Item }, stand: Stand): Behaviour<World> {
  const round = (s: 1 | -1): Leg[] => [
    [1.0, at(0.3 * s, 0.14, 0.34)], // off the table, out in front
    [1.1, at(0.26 * s, 0.07, -0.05)], // out round the hips: the strap behind them
  ];
  const hips = facingAt(k, 'hips');
  const front = onBone(k.h, INDEX.hips, at(0, 0.07, 0.27), { facing: true });
  return function* () {
    yield* take(k, { left: [belt.buckle, 'end'], right: [belt.tongue, 'end'] }, { stand })();
    yield* along(k, hips, [
      [belt.buckle, { left: 'end' }, round(1)],
      [belt.tongue, { right: 'end' }, round(-1)],
    ])();
    // (drawn round to before the belly, the ends together, the tongue through the buckle and pulled tight)
    yield* eyesOn(
      k,
      (f) => front(f).position,
      along(k, hips, [
        [belt.buckle, { left: 'end' }, [[0.8, at(0.17, 0.06, 0.2)], [0.6, at(0.035, 0.07, 0.27)], [0.75, still]]],
        [belt.tongue, { right: 'end' }, [[0.8, at(-0.17, 0.06, 0.2)], [0.6, at(-0.035, 0.07, 0.27)], [0.4, at(0.005, 0.07, 0.275)], [0.35, at(-0.05, 0.07, 0.27)]]],
      ]),
      0,
    )();
    yield* wear(k.h, belt.buckle, INDEX.hips)();
    yield* wear(k.h, belt.tongue, INDEX.hips)();
    yield* busy(k, release(k.h, ['left', 'right']))();
  };
}

/** where the scabbard's throat hangs on the belt: before the left hip, the hilt up and forward, the scabbard down and back 35° and its chape out 13° (clear of the thigh swinging back and of the arm hanging beside it) */
const HANGING = at(0.165, 0.03, 0.12, turn(0.6, 0, 0.22));

/** The sword, in its scabbard, taken by the throat (left hand) where it leans (facing the way it leans), hung on the belt at the left hip, worn there. */
export function hangSword(k: Knight, scabbard: Item): Behaviour<World> {
  // (straight up first: its chape on the floor by the feet; out to the side upright, turned to hang there, then in to the hip: round the outside of the thigh)
  const up = (s: Required<Placement>) => at(s.position.x, s.position.y + 0.3, s.position.z);
  return function* () {
    yield* take(k, { left: [scabbard, 'throat'] }, { face: yawOf(scabbard.current.quaternion) })();
    yield* along(k, facingAt(k, 'hips'), [[scabbard, { left: 'throat' }, [[0.6, up], [0.6, at(0.3, 0.32, 0.3)], [0.7, at(0.34, 0.24, 0.22, HANGING.quaternion)], [0.8, HANGING]]]])();
    yield* wear(k.h, scabbard, INDEX.hips)();
    yield* busy(k, release(k.h, ['left']))();
  };
}

/**
 * the scabbard tilted to present the hilt (in the hips' frame, facing as the body does): the left
 * hand below the locket pulls its throat forward and tips it over, the hilt forward and up before
 * the belly, the chape back
 */
const PRESENTED = at(0.15, 0.06, 0.22, turn(1.0, 0, 0.3));

/**
 * Checking the sword draws, as one draws from the belt: the eyes on the hilt, the left hand grasps
 * the scabbard below its locket and tilts it forward, presenting the hilt; the right takes the hilt
 * across the body and draws a hand's breadth and more of the blade (30 cm) out along the scabbard,
 * holds a moment and sheathes it again, home into it; the scabbard hung back as it was, the hands
 * let go.
 */
export function checkDraw(k: Knight, sword: Item, scabbard: Item): Behaviour<World> {
  const hilt = onItem(sword, sword.grips.hilt);
  const sheath = onItem(scabbard, ORIGIN);
  const hips = facingAt(k, 'hips');
  const presented = course(scabbard, hips, [[0.6, PRESENTED]], { scale: k.h.proportions.scale, pace: k.pace });
  // (held where it is presented while the right hand draws: the scabbard moved before the sword it carries)
  const steady = hold(k.h, scabbard, { left: 'below' }, { to: presented.to });
  return busy(
    k,
    eyesOn(
      k,
      (f) => hilt(f).position,
      function* () {
        yield* pause(k, SETTLE)();
        yield* reachFor(k.h, { left: [scabbard, 'below'] })();
        yield* takeOff(k.h, scabbard)();
        yield* carry(k.h, [[scabbard, { left: 'below' }, presented.to]], { until: presented.over })();
        yield* parallel<F>('race', steady, reachFor(k.h, { right: [sword, 'hilt'] }));
        yield* takeOff(k.h, sword)();
        const drawn = course(sword, (f) => ({ position: sheath(f).position, quaternion: scabbard.current.quaternion.clone() }), [[0.7, at(0, 0.3, 0)], [0.5, still], [0.8, at(0, 0, 0)]], { pace: k.pace });
        yield* parallel<F>('race', steady, carry(k.h, [[sword, { right: 'hilt' }, drawn.to]], { until: drawn.over }));
        yield* wear(k.h, sword, scabbard, { to: { position: new Vector3(), quaternion: new Quaternion() } })();
        yield* parallel<F>('race', release(k.h, ['right']), steady);
        yield* along(k, hips, [[scabbard, { left: 'below' }, [[0.6, HANGING]]]])();
        yield* wear(k.h, scabbard, INDEX.hips)();
        yield* release(k.h, ['left'])();
      },
      0,
    ),
  );
}
