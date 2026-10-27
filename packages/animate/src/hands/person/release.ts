import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { movingPoint, type Goal } from '../../kernel/goal';
import { reached } from '../../kernel/tip';
import { during, type Request } from '../../kernel/requests';
import { clearArm, reaching } from './arms';
import { ARM_REACH } from './bend';
import { INDEX, type Side } from '../../species/humanoid/bones';
import type { Reacher } from './reacher';

/**
 * Hands that let go backing out: each off what it held, carried on the way it was going (its follow-through) and toward its rest beside
 * the thigh, within what the arm reaches (never folded nor stretched out), the body not bowing nor rising after it. Once they are there,
 * or `LETTING_GO` s on, the free arms take them.
 */
export function* backingOut(person: Reacher, request: Request, sides: readonly Side[]) {
  const proportions = person.proportions, began = person.frame.time;
  let targets: ((f: Frame) => Goal)[] | null = null, time = NaN, goals: Goal[] = [];
  // (where each hand goes, from how it moved as it let go)
  const off = (f: Frame): Goal[] => {
    if (time === f.time) return goals;
    targets ??= sides.map((side) => {
      const hand = f.prev.position(person.hands[side]);
      const shoulder = f.prev.position(INDEX[`${side}UpperArm`]);
      const sign = side === 'left' ? 1 : -1;
      const rest = new Vector3(sign * REST.aside * proportions.scale, -REST.down * proportions.armLength, REST.ahead * proportions.scale);
      const at = shoulder.clone().add(rest.applyQuaternion(_turned.setFromAxisAngle(UP, person.locomotion.facing)));
      _v.subVectors(hand, f.prev2.position(person.hands[side])).divideScalar(f.dt).clampLength(0, FOLLOWING_ON / FOLLOW_THROUGH);
      at.addScaledVector(_v, FOLLOW_THROUGH);
      clearArm(person, f, side, at);
      // (within what the arm reaches from its shoulder)
      const reach = at.sub(shoulder);
      reach.setLength(Math.min(Math.max(reach.length(), FOLDED * proportions.armLength), ARM_REACH * proportions.armLength));
      const local = reach.add(shoulder).sub(f.current.position(INDEX.hips)).applyQuaternion(_turned.setFromAxisAngle(UP, -person.locomotion.facing)).divideScalar(proportions.scale);
      return movingPoint(person, INDEX.hips, () => ({ position: local }), () => new Quaternion().setFromAxisAngle(UP, person.locomotion.facing));
    });
    time = f.time;
    goals = targets.map((target) => {
      const { position, velocity } = target(f);
      return { position, velocity };
    });
    return goals;
  };
  const done = (f: Frame) => f.time - began > LETTING_GO || sides.every((side, k) => reached(f, person.hands[side], off(f)[k]));
  // (a hand that has taken hold of something again is no longer backing out: its hold keeps it once the grab that took it is over)
  yield* parallel<Frame>('all', ...sides.map((side, k) => during(request, `hand.${side}`, 'borrowed', reaching(person, side, (f) => off(f)[k], { lead: false }),
    (f) => done(f) || person.holding[side] !== null)));
}

/** How long a hand’s own motion carries it on (s) and how far at most (m), and how long before the free arms take it (s) */
const FOLLOW_THROUGH = 0.15, FOLLOWING_ON = 0.08, LETTING_GO = 1;
/** how near its shoulder a hand going off is put at least (× the arm's length) */
const FOLDED = 0.45;
/** Tuned release staging: a relaxed wrist beside the thigh, elbow slightly bent (m, the drop × the arm's length) */
const REST = { aside: 0.12, down: 0.88, ahead: 0.08 };
const UP = new Vector3(0, 1, 0), _turned = new Quaternion(), _v = new Vector3();
