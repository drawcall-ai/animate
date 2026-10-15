import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../core/body';
import type { Behaviour, Target } from '../../core/goal';
import { seeded, seedOf } from '../../core/random';
import { reached } from '../../core/tip';
import { ARM_REACH, handTo } from '../arms';
import { INDEX, SIDES, type Side } from '../bones';
import type { Humanoid } from '../humanoid';
import { lerp } from '../../core/math';
import { onBone } from '../goal';
import { openHand } from './grips';

// Letting go.

/**
 * Letting go with the hands `sides`: they open and go off what they held, together, each carried
 * on the way it was going (its follow-through) and away from what it held (out from the item's
 * middle and back toward the shoulder, AWAY: how far seeded by the item and grip), or by `away`
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
      (targets ??= sides.map((side, k) => {
        const hand = f.prev.position(INDEX[`${side}Hand`]);
        const shoulder = f.prev.position(INDEX[`${side}UpperArm`]);
        const at = hand.clone();
        const away = options.away?.[side];
        if (away) at.add(away.clone().multiplyScalar(p.scale).applyQuaternion(_turned.setFromAxisAngle(UP, h.gait.facing)));
        else {
          const grip = held[k];
          const out = grip ? _d.subVectors(hand, grip.item.current.position).normalize() : _d.set(0, 0, 0);
          const back = _e.subVectors(shoulder, hand).normalize();
          const rand = seeded(seedOf(grip?.grip ?? side, Math.round(hand.x * 1000), Math.round(hand.z * 1000)));
          at.addScaledVector(out.add(back).normalize(), lerp(AWAY[0], AWAY[1], rand()) * p.scale);
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
    for (const item of loose) if (!h.worn.has(item) && !SIDES.some((s) => h.holding[s]?.item === item)) item.supported = true;
    yield* parallel<Frame<W>>('all', ...sides.map((side, k) => handTo(h, side, (f) => off(f)[k], { lead: false, until })));
  };
}

/**
 * letting go, how far a hand goes off what it held (m, default body; seeded between), how long its
 * own motion carries it on (s) and how far at most (m), and how long it goes off before the free
 * arms take it, unless told (s)
 */
const AWAY = [0.06, 0.12];
const FOLLOW_THROUGH = 0.15;
const FOLLOWING_ON = 0.08;
const LETTING_GO = 1;
/** how near its shoulder a hand going off is put at least (× the arm's length) */
const FOLDED = 0.45;

const UP = new Vector3(0, 1, 0);
const _turned = new Quaternion();
const _v = new Vector3();
const _d = new Vector3();
const _e = new Vector3();
