import { Quaternion, Vector3 } from 'three';
import { runTimeline, type ReusableTimeline } from '@pmndrs/timeline';
import type { ReadonlyPose } from '../src/kernel/pose';
import type { Gazer } from '../src/species/define';
import { Body, humanoid, type BodyOptions } from '../src/index';
import { selfOf } from '../src/body/body';
import { during, type Channel, type Tier } from '../src/kernel/requests';
import type { Frame } from '../src/kernel/frame';
import type { Go } from '../src/kernel/go';
import type { Person } from '../src/body/person';
import { personOf } from '../src/body/person';
import { PERSON } from '../skills/animate/references/person';

/** the sub-step (s) */
export const dt = 1 / 60;

/** a bare person of the default proportions — or as tall as `height` (m), every bone scaled by it */
export const person = (options: BodyOptions = {}, height = 1.75) => new Body(humanoid(height === 1.75 ? PERSON : scaled(height / 1.75)), options);

/** the default person's skeleton, every position times `factor` */
const scaled = (factor: number) => PERSON.map((bone) => ({ ...bone, position: [bone.position[0] * factor, bone.position[1] * factor, bone.position[2] * factor] as const }));

/** a person's feet as its stepper has them: where each stands or lands, which way it points, planted or swinging */
export const feetOf = (h: Person) => (h.stepper?.legs ?? []).map((leg) => ({ position: leg.anchor, yaw: leg.yaw, phase: leg.swing ? 'swing' : 'planted' }));

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
export function claim(body: Body, channel: Channel, step: (f: Frame) => Go | void, tier: Tier = 'asked'): () => void {
  const self = selfOf(body);
  const request = self.file('test', '', (filed) => () => during(filed, channel, tier, (f) => {
    filed.renewed = f.time;
    return step(f);
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

/** how far (rad) a gazer's eyes are off `point` (world): the head's line off it, less what the eyes take of a gaze shift at most (`lookAt`) */
export function gazeOff(gazer: Gazer, pose: ReadonlyPose, point: Readonly<Vector3>): number {
  const _d = new Vector3(), _eyes = new Vector3(), _rel = new Quaternion();
  if (gazer.neck === undefined) throw new Error('gazeOff: the gaze has no neck');
  const bones = pose.skeleton.chain(gazer.neck);
  const head = pose.rotation(bones[bones.length - 1]);
  const d = _d.subVectors(point, gazer.eyes(pose, _eyes)).applyQuaternion(_rel.copy(head).invert());
  const off = Math.atan2(Math.hypot(d.x, d.y), d.z);
  const side = Math.atan2(d.x, d.z) / gazer.range.side;
  const pitch = Math.atan2(-d.y, Math.hypot(d.x, d.z));
  const used = Math.hypot(side, pitch / (pitch > 0 ? gazer.range.down : gazer.range.up));
  return used > 1 ? off * (1 - 1 / used) : 0;
}
