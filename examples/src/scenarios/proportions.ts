import { Group, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { reach, walkTo } from '@drawcall/animate';
import type { Person, Scenario } from '../scenario';
import { OUTLIER, PERSON, SOLDIER } from '../skeletons';
import { ball } from '../things';

/** where the three walk from (x), and how far ahead and how high the ball each touches is */
const LANES = [-1.4, 0, 1.4];
const BALL = { ahead: 4.4, height: 1.1 };

/**
 * Three people unlike each other — the default body, the soldier's skeleton (arms short for its 1.8 m) and an outlier's (legs 0.7×,
 * trunk and arms 1.3× the default's) — walk the same way side by side, touch a ball at the same place and walk back: the library
 * measures each skeleton it is given, so each steps as its legs and reaches as its arms do.
 */
export function proportions(): Scenario {
  return {
    id: 'proportions', title: 'Three bodies, three proportions', duration: 16, cameraDistance: 6,
    description: 'The default body, the soldier\'s skeleton (short arms) and an outlier\'s (short legs, long trunk and arms) walk side by side, each touches a ball and walks back.',
    stage: (cast) => {
      const scene = new Group();
      const people = [PERSON, SOLDIER, OUTLIER].map((skeleton, lane) => cast.person({ at: new Vector3(LANES[lane], 0, 0) }, skeleton));
      const balls = LANES.map((x) => ball(scene, 'ball', 0.04, new Vector3(x, BALL.height, BALL.ahead)));
      let back = 0;
      const touchAndReturn = function* (person: Person, lane: number) {
        yield* walkTo(person, new Vector3(LANES[lane], 0, 3.6));
        yield* reach(person, { right: balls[lane].position });
        yield* walkTo(person, new Vector3(LANES[lane], 0, 0), { face: 0 });
        back++;
      };
      return {
        scene,
        bodies: people,
        story: () => parallel('all', ...people.map((person, lane) => touchAndReturn(person, lane))),
        done: () => back === people.length,
      };
    },
  };
}
