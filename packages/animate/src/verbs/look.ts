import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { Body, selfOf } from '../body/body';
import type { Self } from '../body/runtime';
import type { Frame } from '../kernel/frame';
import { aiming, looking } from '../look/gaze';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a look goes. */
export interface LookOptions {
  /** the trunk turns and pitches toward it too, as an aim does (a person's): bowing toward a low point, arching back for a high one */
  trunk?: boolean;
  /** the head tipped about the line of sight as it looks (rad, + its left side up: toward its right shoulder): a cocky tilt */
  roll?: number;
  /** the head pitched over the line of sight as it looks (rad, + chin down): a shy look from under the brows, or − the chin up, proud */
  pitch?: number;
  /** ends on this; without it, it keeps looking until its story moves on */
  until?: Until;
}

/**
 * Looks at `target` — a point, an object, or another body: its eyes, followed as they move — the eyes on it, the head turning most of
 * the way (a person's neck within its range, the body bowing to see low down; a creature's posture turning its head), tipped by `roll`
 * and `pitch` as `pose` turns a head, eased in and back out. An aimer, it keeps on until `until`. It asks for the eyes (and the trunk's
 * posture with `trunk`). A body to look at needs eyes (a gaze), and is not the body looking.
 */
export function lookAt(body: Body, target: Target | Body, options: LookOptions = {}): Verb {
  const { roll = 0, pitch = 0 } = options;
  if (!Number.isFinite(roll) || !Number.isFinite(pitch)) throw new Error(`lookAt: a roll of ${roll} and a pitch of ${pitch}, not radians`);
  const self = selfOf(body), point = target instanceof Body ? eyesOf(self, target) : located(finder(self, target));
  return verb(body, 'lookAt', (request) => function* () {
    const look = looking(self, point);
    const tipped = roll !== 0 || pitch !== 0 ? { roll, pitch } : null;
    yield* parallel('all', during(request, 'look', 'asked', (f) => {
      look(f);
      if (tipped) self.headOffset.add(tipped);
    }), options.trunk === true && during(request, 'trunk', 'asked', aiming(self, point)));
  }, options.until, true);
}

/** where what `find` finds is, each sub-step */
const located = (find: ReturnType<typeof finder>) => (f: Frame) => find(f).position;

/** where `seen`'s eyes are each sub-step, as `self` reads its pose: the midpoint between them, as its gaze has them */
function eyesOf(self: Self, seen: Body): () => Vector3 {
  const other = selfOf(seen), gazer = other.gazer, eyes = new Vector3();
  if (other === self) throw new Error('lookAt: a body cannot look at its own eyes');
  if (!gazer) throw new Error(`lookAt: a ${seen.species.name ?? 'custom species'} has no eyes to look at (no gaze): look at one of its bones`);
  return () => gazer.eyes(other.poseFor(self), eyes);
}
