import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import { selfOf, type Body } from '../body/body';
import type { Frame } from '../kernel/frame';
import { aiming, looking } from '../look/gaze';
import { finder, type Target } from './targets';
import { verb, type Until, type Verb } from './story';

/** How a look goes. */
export interface LookOptions {
  /** the trunk turns and pitches toward it too, as an aim does (a person's) */
  trunk?: boolean;
  /** ends on this; without it, it keeps looking until its story moves on */
  until?: Until;
}

/**
 * Looks at `target`: the eyes on it, the head turning most of the way (a person's neck within its range, the body bowing to see low down; a
 * creature's posture turning its head). An aimer, it keeps on until `until`. It asks for the eyes (and the trunk's turn with `trunk`).
 */
export function lookAt(body: Body, target: Target, options: LookOptions = {}): Verb {
  return verb(body, 'lookAt', (request) => function* () {
    const self = selfOf(body), find = finder(self, target), point = (f: Frame) => find(f).position;
    yield* parallel('all', during(request, 'look', 'asked', looking(self, point)), options.trunk === true && during(request, 'trunk', 'asked', aiming(self, point)));
  }, options.until, true);
}
