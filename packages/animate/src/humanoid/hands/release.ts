import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Behaviour, Target } from '../../core/goal';
import { reached } from '../../core/tip';
import { ARM_REACH, handTo } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { onBone } from '../goal';
import { openHand } from './grips';

// Letting go.

/**
 * Letting go with the hands `sides`: they open and go off what they held, together, each carried
 * on the way it was going (its follow-through) and away from what it held (toward the hand's rest beside its thigh), or by `away`
 * (m; in the body's frame facing as it does: left +x, up +y, ahead +z) — as near as its arm
 * reaches (never folded on itself nor stretched out; the body not bowing nor rising after it).
 * Once they are there, or `limit` s on (another task may take a hand on its way), the free arms
 * take them. What they let go of that nothing else holds or wears rests where it was put
 * (`supported`: on a shelf, a table).
 */
export function release<W>(h: Humanoid<W>, sides: readonly Side[], options: { away?: Partial<Record<Side, Vector3>>; limit?: number } = {}): Behaviour<W> {
  const { limit = LETTING_GO } = options;
  return function* () {
    const p = h.proportions;
    const held = sides.map((side) => h.holding[side]);
    let targets: ((f: Frame<W>) => Target)[] | null = null;
    // (where each hand goes, from how it moved as it let go)
    const off = (f: Frame<W>): Target[] =>
      (targets ??= sides.map((side) => {
        const hand = f.prev.position(INDEX[`${side}Hand`]);
        const shoulder = f.prev.position(INDEX[`${side}UpperArm`]);
        const at = hand.clone();
        const away = options.away?.[side];
        if (away) at.add(away.clone().multiplyScalar(p.scale).applyQuaternion(_turned.setFromAxisAngle(UP, h.gait.facing)));
        else {
          const sign = side === 'left' ? 1 : -1;
          at.copy(shoulder).add(new Vector3(sign * REST_ASIDE * p.scale, -REST_DOWN * p.armLength, REST_AHEAD * p.scale).applyQuaternion(_turned.setFromAxisAngle(UP, h.gait.facing)));
          at.addScaledVector(_v.subVectors(hand, f.prev2.position(INDEX[`${side}Hand`])).divideScalar(f.dt).clampLength(0, FOLLOWING_ON / FOLLOW_THROUGH), FOLLOW_THROUGH);
        }
        // (within what the arm reaches from its shoulder)
        const reach = at.sub(shoulder);
        reach.setLength(Math.min(Math.max(reach.length(), FOLDED * p.armLength), ARM_REACH * p.armLength));
        const local = reach.add(shoulder).sub(f.current.position(INDEX.hips)).applyQuaternion(_turned.setFromAxisAngle(UP, -h.gait.facing)).divideScalar(p.scale);
        const following = onBone(h, INDEX.hips, { position: local }, { facing: true });
        return (frame: Frame<W>) => {
          const { position, velocity } = following(frame);
          return { position, velocity };
        };
      })).map((target) => target(f));
    const until = (f: Frame<W>, _: unknown, time: number) => time > limit || sides.every((side, k) => reached(f.prev2, f.prev, f.dt, INDEX[`${side}Hand`], off(f)[k]));
    const loose = held.flatMap((grip) => grip?.item ?? []);
    for (const side of sides) yield* openHand(h, side)();
    for (const item of loose) if (!item.wornBy && !SIDES.some((s) => h.holding[s]?.item === item)) item.supported = true;
    yield* parallel<Frame<W>>('all', ...sides.map((side, k) => handTo(h, side, (f) => off(f)[k], { lead: false, until })));
  };
}

/**
 * How long a hand’s own motion carries it on (s) and how far at most (m), and how long before the free
 * arms take it, unless told (s)
 */
const FOLLOW_THROUGH = 0.15;
const FOLLOWING_ON = 0.08;
const LETTING_GO = 1;
/** how near its shoulder a hand going off is put at least (× the arm's length) */
const FOLDED = 0.45;

// Recalled release tuning: a relaxed wrist beside the thigh, elbow slightly bent; metres except the arm-length share.
const REST_ASIDE = 0.12;
const REST_DOWN = 0.88;
const REST_AHEAD = 0.08;

const UP = new Vector3(0, 1, 0);
const _turned = new Quaternion();
const _v = new Vector3();
