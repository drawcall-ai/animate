import { parallel } from '@pmndrs/timeline';
import { type Body, lookAt, wait } from '@drawcall/animate';
import type { Beat } from './index';
import { artooLives, type Focus, threepioLives } from '../droids/act';
import { procession } from '../procession';
import { roar } from '../gestures';

/**
 * The droids through the ceremony, seen from the dais: R2-D2 and C-3PO stand to Leia's left as the heroes come up the last of the aisle
 * and the steps (R2 bobbing as they climb), watch Luke and then Han as Leia turns to each (the medals, here only her looks), and turn to
 * Chewbacca as he roars, R2 rocking excitedly.
 */
export const beat: Beat & { order: number } = {
  id: 'droids',
  title: 'The droids: R2-D2 rocks and swivels its dome, C-3PO follows events',
  order: 40,
  duration: 60,
  // the heroes start partway up the aisle, so the droids see them arrive without the whole walk
  arrange(marks) {
    for (const mark of [marks.lukeEnter, marks.hanEnter, marks.chewbaccaEnter]) mark.position.z += 19;
  },
  stage({ cast, marks, sound }) {
    const { luke, han, chewbacca, leia, threepio, artoo } = cast;
    let phase: 'arriving' | 'luke' | 'han' | 'roar' | 'over' = 'arriving';
    let finished = false;
    const focus: Focus = () => ({ arriving: luke, luke, han, roar: chewbacca, over: leia } as Record<typeof phase, Body>)[phase];
    // R2 gets excited as the heroes climb to the dais and at Chewbacca's roar
    const excited = () => (phase === 'arriving' && luke.position.z > 31) || phase === 'roar';
    const artooMark = marks.artoo.position.clone();
    // R2's voice, from its dome
    const chirp = (kind: 'cheer' | 'whistle') =>
      sound.play(kind === 'cheer' ? 'r2Cheer1' : 'r2Whistle', { from: artoo.bones.dome, why: `R2-D2 ${kind}s` });

    return {
      story: function* () {
        yield* parallel('race', artooLives(artoo, focus, excited, Infinity, chirp), threepioLives(threepio, focus, Infinity), function* () {
          if (!(yield* procession(cast, marks))) return;
          phase = 'luke';
          yield* lookAt(leia, luke, { until: 4 });
          phase = 'han';
          yield* lookAt(leia, han, { until: 4 });
          phase = 'roar';
          yield* parallel('all', lookAt(leia, chewbacca, { until: 3.5 }), roar(chewbacca, 1.6, () => sound.play('roar', { from: chewbacca.bones.head, why: 'Chewbacca roars' })));
          yield* wait(1.5);
          phase = 'over';
          yield* wait(3);
          finished = true;
        });
      },
      // R2 rocked in place: both its feet still beside its mark
      done: () => finished && artoo.feet.every((foot) => foot.planted && foot.position.distanceTo(artooMark) < 0.45),
    };
  },
};
