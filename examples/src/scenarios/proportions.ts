import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { touch, walkTo, type Frame } from '@drawcall/animate';
import { idle } from '@drawcall/animate/rig';
import { Report } from '../report';
import type { Scenario } from '../scenario';

/** where the three walk from (x) and the ball each touches, as far ahead and as high as for the default body */
const LANES = [-1.4, 0, 1.4];
const BALL = new Vector3(0, 1.1, 4.4);

/**
 * Three people unlike each other — the default body, the soldier's skeleton (arms short for its 1.8 m) and an outlier's (legs 0.7×,
 * trunk and arms 1.3× the default's) — walk the same way side by side, touch a ball at the same place and walk back: the library
 * measures each skeleton it is given, so each steps as its legs and reaches as its arms do.
 */
export function proportions(): Scenario {
  return {
    id: 'proportions', title: 'Three bodies, three proportions', duration: 16, cameraDistance: 6, body: 'openpose',
    description: 'The default body, the soldier\'s skeleton (short arms) and an outlier\'s (short legs, long trunk and arms) walk side by side, each touches a ball and walks back.',
    actors: [{ position: { x: LANES[0], z: 0 } }, { position: { x: LANES[1], z: 0 }, skeleton: 'soldier' }, { position: { x: LANES[2], z: 0 }, skeleton: 'outlier' }],
    stage: () => {
      const report = new Report();
      const balls = LANES.map((x) => BALL.clone().setX(x));
      let back = 0;
      return {
        report,
        props: () => balls.map((position) => ({ kind: 'ball', position, radius: 0.04 })),
        done: () => back === LANES.length,
        // (each its own base, `idle`, under its walk and touch)
        script: (h, i) => () => parallel<Frame>('all', idle(h), function* () {
          yield* walkTo(h, { to: new Vector3(LANES[i], 0, 3.6) })();
          yield* touch(h, 'right', balls[i])();
          yield* walkTo(h, { to: new Vector3(LANES[i], 0, 0), face: 0 })();
          back++;
        }),
      };
    },
  };
}
