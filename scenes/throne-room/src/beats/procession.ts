import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { lookAt, wait, walkTo } from '@drawcall/animate';
import { HALL } from '../hall';
import type { Beat } from './index';

// The entrance: Luke, Han (on his left) and Chewbacca (on his right) walk up the aisle side by side at a slow ceremonial pace,
// looking about the hall, then climb the steps to the marks where they will be decorated, their eyes on Leia before they stop.

/** the ceremonial pace up the aisle (m/s), and on the steps, where a stride is about one tread */
const AISLE_PACE = 0.85;
const STEPS_PACE = 0.5;
/** where the walk abreast ends and each climbs to its own mark: just before the first riser */
const FOOT_OF_STEPS = HALL.steps.start - 0.4;

/**
 * Each hero's lane: its x across the aisle, how far ahead of Luke it walks (m; Han a touch ahead, Chewbacca lumbering a touch
 * behind) and the glances it takes on the way up, each a point to its left (x), up (y) and ahead (z) of where it is, held for some seconds.
 */
interface Lane {
  x: number;
  ahead: number;
  glances: readonly (readonly [x: number, y: number, z: number, seconds: number])[];
}
const LANES = {
  // Luke is awed: up at the banners, across at the ranks, up again
  luke: { x: 0, ahead: 0, glances: [[0, 1.6, 8, 2.5], [9, 7, 6, 3], [-6, 1.6, 5, 2.5], [-10, 8, 7, 3], [6, 1.7, 4, 2.5], [0, 4, 12, 3]] },
  // Han is at ease: a look ahead, one over the ranks to his left, a glance at Luke
  han: { x: 1.1, ahead: 0.15, glances: [[0, 1.6, 10, 4], [7, 1.7, 3, 2.5], [-1.1, 1.5, 0.6, 1.2], [0, 1.7, 10, 4], [6, 2.5, 6, 2.5]] },
  // Chewbacca takes it in slowly
  chewbacca: { x: -1.2, ahead: -0.2, glances: [[0, 2, 9, 4], [-8, 4, 5, 4], [0, 2.2, 10, 3], [-6, 1.8, 2, 3]] },
} as const satisfies Record<string, Lane>;
type Hero = keyof typeof LANES;
const HEROES = Object.keys(LANES) as Hero[];

export const beat: Beat & { order: number } = {
  id: 'procession',
  title: 'Entrance: up the aisle and the steps',
  order: 1,
  duration: 75,
  stage({ cast, marks }) {
    const mark = (hero: Hero) => marks[`${hero}Decorated`];
    const leia = cast.leia;

    // a pace-setter all three follow, so they keep abreast whatever their own tempo: a point moving up the aisle at the ceremonial pace,
    // a little ahead of each (a walk to a point it has reached settles; one kept ahead keeps the stride going). Its pace is a little under the walkers'
    // top speed, so they fall into line within a few strides and then keep its pace rather than chasing it.
    const startZ = marks.lukeEnter.position.z;
    let pacerStart: number | undefined;
    const pacer = (time: number) => {
      pacerStart ??= time;
      return Math.min(FOOT_OF_STEPS, startZ + 0.6 + (time - pacerStart) * AISLE_PACE);
    };

    function* walkUp(hero: Hero) {
      const body = cast[hero], lane = LANES[hero];
      const point = new Vector3();
      const ahead = (time: number) => point.set(lane.x, 0, pacer(time) + lane.ahead);
      yield* walkTo(body, ahead, { speed: AISLE_PACE * 1.1, until: () => body.position.z > FOOT_OF_STEPS - 1.2 + lane.ahead });
      // the climb: shorter strides, each hero onto its own mark, arriving turned toward the dais (the mark's +Z)
      if (!(yield* walkTo(body, mark(hero), { speed: STEPS_PACE, accel: 0.8 }))) return false;
      // a walk ends with the last step still dying away; standing still (`settled`) comes a moment later
      return yield* wait(() => body.settled);
    }

    function* lookAbout(hero: Hero) {
      const body = cast[hero];
      const point = new Vector3();
      const nearSteps = () => body.position.z > FOOT_OF_STEPS - 6;
      // the glances over again, until the steps are near; each follows the walker, so it stays ahead as he goes
      for (let glance = 0; !nearSteps(); glance++) {
        const [x, y, z, seconds] = LANES[hero].glances[glance % LANES[hero].glances.length];
        yield* parallel('race', lookAt(body, () => point.set(body.position.x + x, y, body.position.z + z), { until: seconds }), wait(nearSteps));
      }
      // nearing the steps, the eyes find Leia before the feet stop (the anticipation of standing before her)
      yield* lookAt(body, leia);
    }

    const onMarks = () => HEROES.every((hero) => {
      const body = cast[hero], target = mark(hero).position;
      return body.settled && Math.hypot(body.position.x - target.x, body.position.z - target.z) < 0.15 && body.position.y > target.y - 0.02;
    });
    // each hero walks and looks about at once; the look is an aimer, so it ends when that hero is on its mark. The beat ends once all
    // three stand there together: one that settled first may still shift its weight with a step while the last comes to rest.
    const story = function* () {
      yield* parallel('all', ...HEROES.map((hero) => parallel('race', walkUp(hero), lookAbout(hero))));
      yield* parallel('race', wait(onMarks), ...HEROES.map((hero) => lookAt(cast[hero], leia)));
    };
    return { story, done: onMarks };
  },
};
