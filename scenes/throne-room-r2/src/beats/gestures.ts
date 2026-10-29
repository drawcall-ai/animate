import { Object3D } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, type Body, lookAt, pose, type Verb, wait, walkTo } from '@drawcall/animate';
import type { Beat } from '.';
import { DAIS } from '../hall';
import { bowForMedal, cockyWink, roar, stepBackAndNod } from '../gestures';

/** how long Leia's hands take to hang a medal around a neck (s), once she stands before its wearer (the film's is about 2.5 s) */
const HANGING_SECONDS = 2.4;

/**
 * The medal moment's gestures, with the heroes standing at their ceremony marks and no medals: Leia steps up to Luke, who bows as she
 * "hangs" his medal and straightens with a proud look; she steps back and nods. She does the same for Han, who winks at her with a
 * cocky half-nod; then Chewbacca throws his head back and roars, and she looks to him.
 */
export const beat: Beat & { order: number } = {
  id: 'gestures',
  title: 'Medal gestures: Luke bows, Han winks, Chewbacca roars, Leia nods',
  order: 50,
  duration: 40,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ scene, marks, cast }) {
    const { luke, han, chewbacca, leia } = cast;
    // where Leia stands to hang a hero's medal: at the dais's front edge, straight before him, facing the doors
    const before = (hero: Body) => {
      const spot = new Object3D();
      spot.position.set(hero.position.x, DAIS.height, DAIS.top + 0.3);
      spot.rotation.y = Math.PI;
      scene.add(spot);
      spot.updateMatrixWorld();
      return spot;
    };
    const steps = { luke: false, han: false, roar: false };

    /** Leia steps up to `hero`, hangs his medal (while `receive` is his gesture, started as she arrives), steps back to her mark and nods */
    function* decorate(hero: Body, receive: (hung: () => boolean) => Verb): Verb {
      let hung = false;
      let stepped = false;
      yield* parallel(
        'all',
        function* () {
          yield* walkTo(leia, before(hero), { speed: 0.6, until: arriving(leia, 0.3) });
          yield* parallel('race', lookAt(leia, hero), pose(leia, { head: { pitch: 0.15 } }), wait(HANGING_SECONDS));
          hung = true;
          stepped = yield* stepBackAndNod(leia, marks.leia, hero);
        },
        function* () {
          // he readies himself as she comes up to him
          yield* wait(arriving(leia, 0.6));
          yield* receive(() => hung);
        },
      );
      return stepped;
    }

    function* story() {
      steps.luke = yield* decorate(luke, (hung) => bowForMedal(luke, leia, hung));
      steps.han = yield* decorate(han, function* (hung) {
        yield* wait(hung);
        // as she comes back to her place (the film's wink answers her look from there)
        yield* wait(() => leia.position.distanceTo(marks.leia.position) < 0.4);
        return yield* cockyWink(han, leia);
      });
      // Chewbacca's roar, Leia turning to it with a smile
      yield* parallel('race', lookAt(leia, chewbacca), function* () {
        yield* wait(0.3);
        steps.roar = yield* roar(chewbacca);
        yield* wait(1);
      });
      yield* wait(1.5);
    }
    return { story, done: () => steps.luke && steps.han && steps.roar };
  },
};
