import { Body, humanoid, type BodyOptions } from '../src';
import { selfOf } from '../src/body/body';
import { during, type Channel, type Tier } from '../src/body/requests';
import type { Frame } from '../src/core/frame';
import type { Person } from '../src/humanoid/person';
import { personOf } from '../src/humanoid/person';
import { PERSON } from './skeletons/person';

/** the sub-step (s) */
export const dt = 1 / 60;

/** a bare person of the default proportions */
export const person = (options: BodyOptions = {}) => new Body(humanoid(PERSON), options);

/** `body`'s runtime, as a person */
export const insides = (body: Body): Person => personOf(selfOf(body));

/** `body` updated `seconds` in sub-steps, `each` after every one */
export function run(body: Body, seconds: number, each?: (time: number) => void): void {
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    body.update(dt);
    each?.(t);
  }
}

/** a request on `body` that takes `channel` at `tier` for as long as it is not dropped, `step` its every sub-step; returns the drop */
export function claim(body: Body, channel: Channel, step: (f: Frame) => void, tier: Tier = 'asked'): () => void {
  const self = selfOf(body);
  const request = self.file('test', '', (filed) => () => during(filed, channel, tier, step));
  return () => self.drop(request);
}
