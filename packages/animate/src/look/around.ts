import { Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { seeded } from '../kernel/random';
import type { ReadonlyPose } from '../kernel/pose';
import type { PersonLegged } from '../legs/person/legged';

import { forwardOf, lerp, smoothstep } from '../kernel/math';
import { steadiness } from '../species/define';

/** a person as its idle eyes see it: how it walks, its proportions, the floor it walks on and how still its life holds it */
type Walking = Pick<PersonLegged, 'locomotion' | 'proportions' | 'floor' | 'life'>;

/** the share of the thorax's gait rotation the head goes along with (CMU mocap: ~55%) */
const HEAD_SHARE = 0.55;
/** standing, the eyes rest ahead a little below eye level; walking, on the path a few steps ahead (× height up off the floor there, m ahead) */
const AHEAD = { stand: { height: 0.75, distance: 3 }, walk: { height: 0.35, distance: 4.5 } };
/** standing still, a glance aside every so often (s apart, s held, rad aside at most and up or down at most) */
const GLANCES = { every: [2.5, 5], hold: [0.8, 1.6], aside: 0.7, pitch: 0.15 };

/** Idle gaze follows the walking path; standing glances vary deterministically with `seed`, the less aside the stiller its life holds it. */
export function lookAround(person: Walking, seed: number): (f: Frame) => Vector3 {
  const rand = seeded(seed);
  const target = new Vector3();
  let next = lerp(GLANCES.every[0], GLANCES.every[1], rand());
  let until = 0, aside = 0, up = 0;
  const proportions = person.proportions;
  return (f) => {
    const locomotion = person.locomotion;
    // (glances only standing still: walking, the eyes are on the way)
    if (locomotion.walk > 0.05) {
      next = Math.max(next, f.time + GLANCES.every[0]);
      until = 0;
    }
    if (f.time >= next) {
      until = f.time + lerp(GLANCES.hold[0], GLANCES.hold[1], rand());
      next = until + lerp(GLANCES.every[0], GLANCES.every[1], rand());
      aside = (2 * rand() - 1) * GLANCES.aside;
      up = (2 * rand() - 1) * GLANCES.pitch;
    }
    const glance = f.time < until ? 1 - steadiness(person.life, f.time) : 0;
    const w = smoothstep(0.1, 0.6, locomotion.walk);
    const distance = lerp(AHEAD.stand.distance, AHEAD.walk.distance, w);
    const height = lerp(AHEAD.stand.height, AHEAD.walk.height, w) * proportions.height + glance * up * distance;
    const yaw = (locomotion.facingAhead ?? locomotion.facing) + HEAD_SHARE * locomotion.thoraxYaw + glance * aside;
    return onFloor(person, target.copy(f.prev.com(_com)).addScaledVector(forwardOf(yaw, _v), distance), height);
  };
}

/** The walking gaze's path point, shared by a long approach and the idle gaze. */
export function pathAhead(person: Walking, pose: ReadonlyPose, out: Vector3): Vector3 {
  out.copy(pose.com(_com)).addScaledVector(forwardOf(person.locomotion.facingAhead ?? person.locomotion.facing, _v), AHEAD.walk.distance);
  return onFloor(person, out, AHEAD.walk.height * person.proportions.height);
}

/** `at` (x, z) `height` m over the floor under it */
const onFloor = (person: Walking, at: Vector3, height: number) => at.setY(person.floor(at.x, at.z) + height);

const [_com, _v] = [new Vector3(), new Vector3()];

