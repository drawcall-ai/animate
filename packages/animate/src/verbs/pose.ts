import { parallel } from '@pmndrs/timeline';
import { during } from '../kernel/requests';
import type { Posture } from '../kernel/poise';
import { selfOf, type Body } from '../body/body';
import { verb, type Until, type Verb } from './story';

/** How a pose goes. */
export interface PoseOptions {
  /** ends on this; without it, it holds the posture until its story moves on */
  until?: Until;
}

/**
 * Poses `body` as `posture` has it, over whatever else it does (standing, walking, reaching, looking): a bow, a back arched with the chest
 * lifting, a turn or a sideways lean of the trunk, a nod or a tilt of the head. Each angle is added onto what the body's own tasks ask (a
 * reach's bow, a look's head), eased in at the pace of a squat for the trunk and a nod for the head, held in balance and within the
 * joints, and eased back out once the pose ends — so a nod is a short pose, and poses one after another flow into each other. A creature
 * takes the trunk's as its body turns about its legs, as far as they let it. An aimer, it keeps on until `until`. It asks for the
 * trunk's posture with a trunk field and for the head's turn with `head` — not for the eyes: a look beside it keeps them, and the head
 * turns over where they look.
 */
export function pose(body: Body, posture: Posture, options: PoseOptions = {}): Verb {
  const { head, ...trunk } = posture;
  for (const [name, value] of Object.entries({ ...trunk, ...head })) {
    if (!Number.isFinite(value)) throw new Error(`pose: ${name} ${value} is no number of radians or metres`);
  }
  const self = selfOf(body);
  if (head && !self.gazer) throw new Error(`pose: a ${body.species.name ?? 'custom species'} has no head to turn (no gaze)`);
  const asked = { bow: trunk.bow ?? 0, twist: trunk.twist ?? 0, lean: trunk.lean ?? 0, lower: trunk.lower ?? 0 };
  const posed = Object.keys(trunk).length > 0;
  return verb(body, 'pose', (request) => function* () {
    yield* parallel('all',
      posed && during(request, 'trunk', 'asked', () => self.poise.add({ posture: asked })),
      head !== undefined && during(request, 'head', 'asked', () => self.headOffset.add(head)));
  }, options.until, true);
}
