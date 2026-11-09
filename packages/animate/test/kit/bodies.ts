import { Quaternion, Vector3 } from 'three';
import { runTimeline, type ReusableTimeline } from '@pmndrs/timeline';
import { Body, humanoid, poseOf, type BodyOptions, type HumanoidBone } from '../../src/index';
import type { Gazer } from '../../src/species';
import { PERSON } from '../../skills/animate/references/person';

/** the sub-step (s) */
export const dt = 1 / 60;

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];

/** a person's bones as its pose has them, by name, as its skeleton lists them */
export const INDEX = Object.fromEntries(humanoid(PERSON).skeleton.bones.map((bone, i) => [bone.name, i])) as Record<HumanoidBone | 'leftToes' | 'rightToes', number>;

/** a bare person of the default proportions — or as tall as `height` (m), every bone scaled by it */
export const person = (options: BodyOptions = {}, height = 1.75) => new Body(humanoid(height === 1.75 ? PERSON : scaled(height / 1.75)), options);

/** the default person's skeleton, every position times `factor` */
const scaled = (factor: number) => PERSON.map((bone) => ({ ...bone, position: [bone.position[0] * factor, bone.position[1] * factor, bone.position[2] * factor] as const }));

/** what a story's author can read of a person: its pose, its species' measures, what it reports */
export function readings(body: Body) {
  const { person: proportions, gaze: gazer, skeleton } = body.species;
  if (!proportions || !gazer) throw new Error('readings: not a person');
  return {
    proportions, gazer, skeleton, hands: { left: INDEX.leftHand, right: INDEX.rightHand },
    get pose() { return poseOf(body); },
    get feet() { return body.feet; },
    get facing() { return body.facing; },
    get velocity() { return body.velocity; },
    get settled() { return body.settled; },
    get log() { return body.log; },
  };
}
export type Readings = ReturnType<typeof readings>;

/** a person's feet: where each stands or lands, which way it points, planted or swinging */
export const feetOf = (h: Readings) => h.feet.map((foot) => ({ position: foot.position, yaw: foot.yaw, phase: foot.planted ? 'planted' : 'swing' }));

/** whether `body` is off the floor: none of its feet down */
export const flying = (body: Body) => body.feet.every((foot) => !foot.planted);

/** `body` updated `seconds` in sub-steps, `each` after every one */
export function run(body: Body, seconds: number, each?: (time: number) => void): void {
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    body.update(dt);
    each?.(t);
  }
}

/**
 * `story` run as an app runs one, a frame of 1/60 s at a time: the story steps, then each body updates; `each` after every frame, until
 * `seconds` or `done`. Returns the time it stopped at (s).
 */
export function play(story: ReusableTimeline<unknown, unknown>, bodies: readonly Body[], seconds: number, each?: (time: number) => boolean | void): number {
  const step = runTimeline(story);
  let t = 0;
  played = 0;
  while (t < seconds - 1e-9) {
    t += dt;
    step(undefined, dt);
    for (const body of bodies) body.update(dt);
    played = t;
    if (each?.(t)) break;
  }
  return t;
}

let played = 0;
/** how long the `play` running has run (s), as far as its bodies have updated: for a story to note the time */
export const now = () => played;

/** one frame of `story` and its `bodies` (1/60 s), as an app steps them: the story, then each body */
export function scene(bodies: readonly Body[], story?: ReusableTimeline<unknown, unknown>): () => void {
  const step = story && runTimeline(story);
  return () => {
    step?.(undefined, dt);
    for (const body of bodies) body.update(dt);
  };
}

/** how far (rad) a gazer's eyes are off `point` (world): the head's line off it, less what the eyes take of a gaze shift at most (`lookAt`) */
export function gazeOff(gazer: Gazer, pose: ReturnType<typeof poseOf>, point: Readonly<Vector3>): number {
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
