import { parallel } from '@pmndrs/timeline';
import { arriving, type Body, wait, walkTo, type Verb } from '@drawcall/animate';
import type { Object3D } from 'three';
import type { Beat } from '.';
import { applaud, attend, createTroops } from '../troops';

// The troops on their own: Luke, Han and Chewbacca walk up the aisle with plain walks (their real walk is the procession's), the
// ranks at attention following them with their eyes; on the steps the heroes turn to face the hall, and the troops turn toward them,
// applaud and settle.

/** the heroes' shared pace up the aisle (m/s), so they keep abreast */
const PACE = 0.9;

export const beat: Beat & { order: number } = {
  id: 'troops',
  title: 'The troops: attention, eyes on the heroes, applause',
  order: 2,
  duration: 90,
  stage({ scene, marks, cast, dress, checkCrowds }) {
    // (in the viewer, ?ranks=, ?bodyRanks=, ?bodyEvery= and ?shadowRanks= change createTroops' options, for measuring what it sustains)
    const query = new URLSearchParams(globalThis.location?.search ?? '');
    const troops = createTroops(dress, { dev: checkCrowds, ranks: Number(query.get('ranks')) || undefined, bodyEvery: Number(query.get('bodyEvery')) || undefined, bodyRanks: Number(query.get('bodyRanks')) || undefined, shadowRanks: query.has('shadowRanks') ? Number(query.get('shadowRanks')) : undefined });
    scene.add(troops.object);
    const heroes = [cast.luke, cast.han, cast.chewbacca];
    let turned = false;
    let finished = false;
    /** a hero's plain walk to where it is decorated, a pause, and its turn there to face the hall */
    function* walkUp(hero: Body, mark: Object3D, delay: number): Verb {
      yield* wait(delay);
      // (ends arriving, or once it has stood within 10 cm of its mark for a second: Chewbacca on the step keeps the walk from ever
      // reporting `arriving` — his feet keep resettling on the tread)
      let near = 0;
      const there = () => (near = hero.position.distanceTo(mark.position) < 0.1 ? near + 1 : 0) > 60;
      const arrived = arriving(hero, 0.3);
      if (!(yield* walkTo(hero, mark, { speed: PACE, until: () => arrived() || there() }))) return false;
      yield* wait(2);
      return yield* walkTo(hero, mark.position, { face: Math.PI });
    }
    return {
      extras: troops.bodies,
      afterStep: troops.afterStep,
      done: () => finished,
      story: function* () {
        yield* parallel(
          'race',
          function* () {
            yield* attend(troops, heroes, { until: () => turned });
            yield* applaud(troops, heroes, { until: () => true });
            finished = true;
          },
          function* () {
            yield* parallel('all', walkUp(cast.luke, marks.lukeDecorated, 0), walkUp(cast.han, marks.hanDecorated, 0.12), walkUp(cast.chewbacca, marks.chewbaccaDecorated, 0.25));
            turned = true;
            yield* wait(Infinity);
          },
        );
      },
    };
  },
};
