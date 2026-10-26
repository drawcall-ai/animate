import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { movingPoint, type Target } from '../../kernel/goal';
import { reached } from '../../kernel/tip';
import { during, type Request } from '../../kernel/requests';
import { ARM_REACH, clearArm, reaching } from './arms';
import { INDEX, type Side } from '../../species/humanoid/bones';
import type { Person } from '../../body/person';

/**
 * Hands that let go backing out: each goes off what it held, carried on the way it was going (its follow-through) and away from it
 * (toward the hand's rest beside its thigh), as near as its arm reaches — never folded on itself nor stretched out, the body not bowing
 * nor rising after it. Once they are there, or `LETTING_GO` s on, the free arms take them.
 */
export function* backingOut(h: Person, request: Request, sides: readonly Side[]) {
  const p = h.proportions, began = h.frame.time;
  let targets: ((f: Frame) => Target)[] | null = null;
  let time = NaN, goals: Target[] = [];
  // (where each hand goes, from how it moved as it let go)
  const off = (f: Frame): Target[] => {
    if (time === f.time) return goals;
    targets ??= sides.map((side) => {
      const hand = f.prev.position(h.hands[side]);
      const shoulder = f.prev.position(INDEX[`${side}UpperArm`]);
      const sign = side === 'left' ? 1 : -1;
      const at = shoulder.clone().add(new Vector3(sign * REST_ASIDE * p.scale, -REST_DOWN * p.armLength, REST_AHEAD * p.scale).applyQuaternion(_turned.setFromAxisAngle(UP, h.locomotion.facing)));
      _v.subVectors(hand, f.prev2.position(h.hands[side])).divideScalar(f.dt).clampLength(0, FOLLOWING_ON / FOLLOW_THROUGH);
      at.addScaledVector(_v, FOLLOW_THROUGH);
      clearArm(h, f, side, at);
      // (within what the arm reaches from its shoulder)
      const reach = at.sub(shoulder);
      reach.setLength(Math.min(Math.max(reach.length(), FOLDED * p.armLength), ARM_REACH * p.armLength));
      const local = reach.add(shoulder).sub(f.current.position(INDEX.hips)).applyQuaternion(_turned.setFromAxisAngle(UP, -h.locomotion.facing)).divideScalar(p.scale);
      return movingPoint(h, INDEX.hips, () => ({ position: local }), () => new Quaternion().setFromAxisAngle(UP, h.locomotion.facing));
    });
    time = f.time;
    goals = targets.map((target) => {
      const { position, velocity } = target(f);
      return { position, velocity };
    });
    return goals;
  };
  const done = (f: Frame) => f.time - began > LETTING_GO || sides.every((side, k) => reached(f, h.hands[side], off(f)[k]));
  yield* parallel<Frame>('all', ...sides.map((side, k) => during(request, `hand.${side}`, 'borrowed', reaching(h, side, (f) => off(f)[k], { lead: false }), done)));
}

/** How long a hand’s own motion carries it on (s) and how far at most (m), and how long before the free arms take it (s) */
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
