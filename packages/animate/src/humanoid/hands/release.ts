import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Body, Frame } from '../../core/body';
import { letGo, personOnly } from '../../core/hands';
import type { Behaviour, Target } from '../../core/goal';
import { reached } from '../../core/tip';
import { ARM_REACH, clearArm, handTo } from '../arms';
import { INDEX, sideOf, type Side } from '../bones';
import { isPerson, type Humanoid } from '../humanoid';
import { facingAt } from '../../core/goal';
import { heldItems } from '../../core/worn';

// Letting go.

/** How `release` goes about it. */
export interface ReleaseOptions<H extends string = string> {
  /** where each hand goes off to (m, in the body's frame), or `null`: only open */
  away?: Partial<Record<H, Vector3>> | null;
  /** seconds before the free arms take the hands, there or not */
  limit?: number;
}

/**
 * Letting go with `hands`: they open and go off what they held, together, each carried
 * on the way it was going (its follow-through) and away from what it held (toward the hand's rest beside its thigh), or by `away`
 * (m; in the body's frame facing as it does: left +x, up +y, ahead +z) — as near as its arm
 * reaches (never folded on itself nor stretched out; the body not bowing nor rising after it).
 * Once they are there, or `limit` s on (another task may take a hand on its way), the free arms
 * take them. What they let go of that nothing else holds or wears rests where it was put
 * (`supported`: on a shelf, a table). With `away: null`, only open: the next task owns the hands. Another body's hands let go and
 * go back to where its base has them.
 */
export function release<H extends string>(body: Body<H>, hands: readonly H[], options: ReleaseOptions<H> = {}): Behaviour {
  if (!isPerson(body)) {
    personOnly('release', options, ['away', 'limit']);
    return letGo(body, hands);
  }
  return person(body, hands.map(sideOf), { limit: options.limit, away: options.away === null ? null : options.away && Object.fromEntries(Object.entries(options.away).map(([hand, at]) => [sideOf(hand), at])) });
}

function person(h: Humanoid, sides: readonly Side[], options: { away?: Partial<Record<Side, Vector3>> | null; limit?: number }): Behaviour {
  const { limit = LETTING_GO } = options;
  return function* () {
    const p = h.proportions;
    let targets: ((f: Frame) => Target)[] | null = null;
    let time = NaN;
    let goals: Target[] = [];
    const open = () => {
      const loose = sides.flatMap((side) => h.holding[side]?.item ?? []);
      for (const side of sides) h.holding[side] = null;
      for (const item of loose) if (!item.wornBy && !heldItems(h).includes(item)) item.supported = true;
    };
    // Keep held contact until the release's hand mover actually starts.
    // (where each hand goes, from how it moved as it let go)
    const off = (f: Frame): Target[] => {
      if (time === f.time) return goals;
      if (!targets) open();
      targets ??= sides.map((side) => {
        const hand = f.prev.position(h.hands[side]);
        const shoulder = f.prev.position(INDEX[`${side}UpperArm`]);
        const at = hand.clone();
        const away = options.away?.[side];
        if (away) at.add(away.clone().multiplyScalar(p.scale).applyQuaternion(_turned.setFromAxisAngle(UP, h.locomotion.facing)));
        else {
          const sign = side === 'left' ? 1 : -1;
          at.copy(shoulder).add(new Vector3(sign * REST_ASIDE * p.scale, -REST_DOWN * p.armLength, REST_AHEAD * p.scale).applyQuaternion(_turned.setFromAxisAngle(UP, h.locomotion.facing)));
          _v.subVectors(hand, f.prev2.position(h.hands[side])).divideScalar(f.dt).clampLength(0, FOLLOWING_ON / FOLLOW_THROUGH);
          at.addScaledVector(_v, FOLLOW_THROUGH);
          clearArm(h, f, side, at);
        }
        // (within what the arm reaches from its shoulder)
        const reach = at.sub(shoulder);
        reach.setLength(Math.min(Math.max(reach.length(), FOLDED * p.armLength), ARM_REACH * p.armLength));
        const local = reach.add(shoulder).sub(f.current.position(INDEX.hips)).applyQuaternion(_turned.setFromAxisAngle(UP, -h.locomotion.facing)).divideScalar(p.scale);
        return facingAt(h, INDEX.hips, { position: local });
      });
      time = f.time;
      goals = targets.map((target) => {
        const { position, velocity } = target(f);
        return { position, velocity };
      });
      return goals;
    };
    const until = (f: Frame, _: unknown, time: number) => time > limit || sides.every((side, k) => reached(f, h.hands[side], off(f)[k]));
    if (options.away === null) { open(); return; }
    yield* parallel<Frame>('all', ...sides.map((side, k) => handTo(h, side, (f) => off(f)[k], { lead: false, until })));
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

// Tuned release staging: a relaxed wrist beside the thigh, elbow slightly bent; metres except the arm-length share.
const REST_ASIDE = 0.12;
const REST_DOWN = 0.88;
const REST_AHEAD = 0.08;

const UP = new Vector3(0, 1, 0);
const _turned = new Quaternion();
const _v = new Vector3();
