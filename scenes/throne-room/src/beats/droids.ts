import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { wait } from '@drawcall/animate';
import { droidsLife, type Cue } from '../droids/life';
import { roar } from '../gestures';
import type { Beat } from './index';

// The droids on the dais through the ceremony, the heroes already before Leia: R2-D2 and C-3PO look down the hall the heroes came up,
// follow Luke's and then Han's medal, R2 rocks with excitement after each, Chewbacca roars (C-3PO starts back, R2 cheers), and they look
// out over the hall for the finale. Nobody else acts, so this beat shows the droids' part alone.

export const beat: Beat & { order: number } = {
  id: 'droids',
  title: 'R2-D2 and C-3PO on the dais',
  order: 4,
  duration: 30,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ cast }) {
    const { artoo, threepio, luke, han, chewbacca } = cast;
    const hall = new Vector3(0, 1.7, 8);
    const cues: Cue[] = [
      { focus: hall, until: 3, artoo: 'watch', threepio: 'watch' },
      { focus: luke.bones.head, until: 3, artoo: 'watch', threepio: 'watch' },
      { focus: luke.bones.head, until: 2.5, artoo: 'cheer', threepio: 'watch' },
      { focus: han.bones.head, until: 3, artoo: 'watch', threepio: 'watch' },
      { focus: han.bones.head, until: 2, artoo: 'cheer', threepio: 'watch' },
      { focus: chewbacca.bones.head, until: 3.5, artoo: 'cheer', threepio: 'startle' },
      { focus: hall, until: 4, artoo: 'cheer', threepio: 'watch' },
    ];
    let finished = false;
    return {
      story: function* () {
        yield* parallel('all', droidsLife(artoo, threepio, cues), function* () {
          yield* wait(14.5);
          yield* roar(chewbacca);
        });
        finished = true;
      },
      done: () => finished,
    };
  },
};
