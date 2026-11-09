import { Quaternion, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import type { Frame } from '../../kernel/frame';
import { movingPoint, type Goal } from '../../kernel/goal';
import { reached } from '../../kernel/tip';
import { during, type Request } from '../../kernel/requests';
import { reaching } from './arms';
import { clearArm } from './hang';
import { ARM_REACH } from './bend';
import { INDEX, type Side } from '../../species/humanoid/bones';
import { BACK } from './press';
import type { Person } from '../../body/person';

/** Release preserves follow-through within arm reach, without recruiting the trunk; idle arms resume on arrival or timeout. A hand given
 * a way `away` (world: a fingertip off its button, `backOff`) draws straight back along it instead (`BACK`), its fingers kept as they
 * pressed until it is off (curling as it left, a fingertip dragged down the face), and stays there until it is asked elsewhere. */
export function* backingOut(person: Person, request: Request, hands: readonly { side: Side; away: Vector3 | null }[]) {
  const sides = hands.map(({ side }) => side);
  const proportions = person.proportions, began = person.frame.time, drawn = began + BACK.seconds / person.tempo;
  for (const { side, away } of hands) if (away) person.drawingBack[side] = drawn;
  let targets: ((f: Frame) => Goal)[] | null = null, time = NaN, goals: Goal[] = [];
  // (where each hand goes, from how it moved as it let go)
  const off = (f: Frame): Goal[] => {
    if (time === f.time) return goals;
    targets ??= hands.map(({ side, away }) => {
      const hand = f.prev.position(person.hands[side]).clone();
      if (away) {
        const back = hand.addScaledVector(away, BACK.distance * person.scale);
        return () => ({ position: back });
      }
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
  // (a fingertip drawn back is held there, off its button, until the hand is asked elsewhere)
  const done = (f: Frame) => f.time - began > LETTING_GO || hands.every(({ away }, k) => !away && reached(f, person.hands[sides[k]], off(f)[k]));
  // (a hand that has taken hold of something again is no longer backing out: its hold keeps it once the grab that took it is over; nor is
  // one whose arm a pose asks for)
  yield* parallel<Frame>('all', ...hands.map(({ side, away }, k) => {
    const step = reaching(person, side, (f) => off(f)[k], { lead: false, ...(away && { seconds: BACK.seconds / person.tempo, straight: true }) });
    return during(request, `hand.${side}`, 'borrowed', (f: Frame) => {
      if (away && f.time < drawn) person.fingers?.keep(side);
      return step(f);
    }, (f) => done(f) || person.holding[side] !== null || (!away && person.owner(`arm.${side}`) !== undefined));
  }));
}

/** How long a hand’s own motion carries it on (s) and how far at most (m), and how long before the free arms take it (s) */
const FOLLOW_THROUGH = 0.15, FOLLOWING_ON = 0.08, LETTING_GO = 1;
/** how near its shoulder a hand going off is put at least (× the arm's length) */
const FOLDED = 0.45;
/** Tuned release staging: a relaxed wrist beside the thigh, elbow slightly bent (m, the drop × the arm's length) */
const REST = { aside: 0.12, down: 0.88, ahead: 0.08 };
const UP = new Vector3(0, 1, 0), _turned = new Quaternion(), _v = new Vector3();
