import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { lookAt, wait, walkTo } from '@drawcall/animate';
import type { Beat } from './index';

// The finale: decorated, the trio turns around on the step to face the hall. Each head goes first, over the shoulder toward the
// troops, and the body follows it round; they turn one after another (Luke, then Han, then Chewbacca), not in lockstep.

const TOWARD_DOORS = Math.PI;

/**
 * Each hero's start (s after the beat begins) and the side it looks over (m of its left, +, or right, −, at the far point). A walk turns
 * the short way round and a half turn has none, so the look goes over the side the feet turn to (all three to their right; Han toward Luke).
 */
const TURNS = {
  luke: { after: 0.6, over: -3 },
  han: { after: 1.0, over: -2 },
  chewbacca: { after: 1.5, over: -6 },
} as const;
type Hero = keyof typeof TURNS;
const HEROES = Object.keys(TURNS) as Hero[];

/** how long the trio stands facing the hall before the beat ends (s) */
const FACING_THE_HALL = 3;

export const beat: Beat & { order: number } = {
  id: 'finale',
  title: 'Finale: the heroes turn to the hall',
  order: 6,
  duration: 20,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ cast, marks }) {
    function* turnAround(hero: Hero) {
      const body = cast[hero], { after, over } = TURNS[hero];
      const mark = marks[`${hero}Decorated`].position;
      yield* wait(after);
      // the troops across the hall, a little to the side the head turns over: the gaze leads, the trunk and feet follow it
      const troops = new Vector3(mark.x + over, 1.7, 18);
      const turn = function* () {
        yield* wait(0.35);
        // turning on the spot: a walk to where it stands, arriving faced the other way
        if (!(yield* walkTo(body, mark.clone(), { face: TOWARD_DOORS, speed: 0.4 }))) return false;
        yield* wait(() => body.settled);
        return yield* wait(FACING_THE_HALL);
      };
      return yield* parallel('race', lookAt(body, troops), turn());
    }

    return {
      story: () => parallel('all', ...HEROES.map(turnAround)),
      done: () => HEROES.every((hero) => {
        const body = cast[hero];
        const off = Math.abs(Math.atan2(Math.sin(body.facing - TOWARD_DOORS), Math.cos(body.facing - TOWARD_DOORS)));
        return body.settled && off < 0.15 && body.position.y > 0.75;
      }),
    };
  },
};
