import type { Beat } from './index';
import { faceHall, heroesFacingHall } from '../procession';

/** The finale: decorated, the trio turn round together on their step to face the hall, and stand proudly. */
export const beat: Beat & { order: number } = {
  id: 'finale',
  title: 'The heroes turn to face the hall',
  order: 60,
  duration: 20,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ cast, marks }) {
    return {
      story: function* () {
        yield* faceHall(cast, 4);
      },
      done: () => heroesFacingHall(cast, marks),
    };
  },
};
