import type { Beat } from './index';
import { heroesBeforeLeia, procession } from '../procession';

/** The entrance: the trio from the doors, side by side up the aisle and the steps, to the step below Leia. */
export const beat: Beat & { order: number } = {
  id: 'procession',
  title: 'The heroes walk up the aisle',
  order: 10,
  duration: 70,
  stage({ cast, marks }) {
    return {
      story: function* () {
        yield* procession(cast, marks);
      },
      done: () => heroesBeforeLeia(cast, marks),
    };
  },
};
