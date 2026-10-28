import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { selfOf, type Body } from '../body/body';
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
 * Looks at `target`: the eyes on it, the head turning most of the way (a person's neck within its range, the body bowing to see low down; a
 * creature's posture turning its head), tipped by `roll` and `pitch` as `pose` turns a head, eased in and back out. An aimer, it keeps on
 * until `until`. It asks for the eyes (and the trunk's posture with `trunk`).
 */
export function lookAt(body: Body, target: Target, options: LookOptions = {}): Verb {
  const { roll = 0, pitch = 0 } = options;
  if (!Number.isFinite(roll) || !Number.isFinite(pitch)) throw new Error(`lookAt: a roll of ${roll} and a pitch of ${pitch}, not radians`);
  return verb(body, 'lookAt', (request) => function* () {
    const self = selfOf(body), find = finder(self, target), point = (f: Frame) => find(f).position, look = looking(self, point);
    const tipped = roll !== 0 || pitch !== 0 ? { roll, pitch } : null;
    yield* parallel('all', during(request, 'look', 'asked', (f) => {
      look(f);
      if (tipped) self.headOffset.add(tipped);
    }), options.trunk === true && during(request, 'trunk', 'asked', aiming(self, point)));
  }, options.until, true);
}
