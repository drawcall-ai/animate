import { runTimeline, type ReusableTimeline } from '@pmndrs/timeline';
import { Body, humanoid, type BodyOptions } from '../src';
import { selfOf } from '../src/body/body';
import { during, type Channel, type Tier } from '../src/body/requests';
import type { Frame } from '../src/core/frame';
import type { Person } from '../src/humanoid/person';
import { personOf } from '../src/humanoid/person';
import { PERSON } from './skeletons/person';

/** the sub-step (s) */
export const dt = 1 / 60;

/** a bare person of the default proportions — or as tall as `height` (m), every bone scaled by it */
export const person = (options: BodyOptions = {}, height = 1.75) => new Body(humanoid(height === 1.75 ? PERSON : scaled(height / 1.75)), options);

/** the default person's skeleton, every position times `factor` */
const scaled = (factor: number) => PERSON.map((bone) => ({ ...bone, position: bone.position.map((x) => x * factor) as [number, number, number] }));

/** `body`'s runtime, as a person */
export const insides = (body: Body): Person => personOf(selfOf(body));

/** `body` updated `seconds` in sub-steps, `each` after every one */
export function run(body: Body, seconds: number, each?: (time: number) => void): void {
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    body.update(dt);
    each?.(t);
  }
}

/**
 * a request on `body` that takes `channel` at `tier` for as long as it is not dropped (no story renews it: it renews itself), `step` its
 * every sub-step; returns the drop
 */
export function claim(body: Body, channel: Channel, step: (f: Frame) => void, tier: Tier = 'asked'): () => void {
  const self = selfOf(body);
  const request = self.file('test', '', (filed) => () => during(filed, channel, tier, (f) => {
    filed.renewed = f.time;
    step(f);
  }));
  return () => self.drop(request);
}

/**
 * `story` run as an app runs one, a frame of 1/60 s at a time: the story steps, then each body updates; `each` after every frame, until
 * `seconds` or `done`. Returns the time it stopped at (s).
 */
export function play(story: ReusableTimeline<unknown, unknown>, bodies: readonly Body[], seconds: number, each?: (time: number) => boolean | void): number {
  const step = runTimeline(story);
  let t = 0;
  while (t < seconds - 1e-9) {
    t += dt;
    step(undefined, dt);
    for (const body of bodies) body.update(dt);
    if (each?.(t)) break;
  }
  return t;
}

/** one frame of `story` and its `bodies` (1/60 s), as an app steps them: the story, then each body */
export function scene(bodies: readonly Body[], story?: ReusableTimeline<unknown, unknown>): () => void {
  const step = story && runTimeline(story);
  return () => {
    step?.(undefined, dt);
    for (const body of bodies) body.update(dt);
  };
}
