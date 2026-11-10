import { Vector3 } from 'three';
import type { Body } from '../../src/index';
import { selfOf } from '../../src/body';
import { personOf } from '../../src/verbs/person-of';
import { during, type Channel, type Tier } from '../../src/kernel/requests';
import type { Frame } from '../../src/kernel/frame';
import type { LegGoal } from '../../src/step/leg-goal';
import type { Person } from '../../src/person/person';
import { palmOf } from '../../src/person/anatomy/landmarks';
import type { Side } from '../../src/person/anatomy/bones';

/** `body`'s self, as the person it is */
export const personSelf = (body: Body): Person => personOf(body, 'personSelf');

/** where `side`'s palm is (world) as `h` is posed: where its hand holds a grip */
export const palmAt = (h: Person, side: Side) => h.pose.point(h.hands[side], palmOf(h.proportions, side), new Vector3());

/** whether `body` is off the floor: a leap's flight */
export const airborne = (body: Body) => selfOf(body).stepper?.airborne ?? false;

/**
 * a request on `body` that takes `channel` at `tier` for as long as it is not dropped (no story renews it: it renews itself), `step` its
 * every sub-step; returns the drop
 */
export function claim(body: Body, channel: Channel, step: (f: Frame) => LegGoal | void, tier: Tier = 'asked'): () => void {
  const self = selfOf(body);
  const request = self.file('test', '', (filed) => () => during(filed, channel, tier, (f) => {
    filed.renewed = f.time;
    return step(f);
  }));
  return () => self.drop(request);
}
