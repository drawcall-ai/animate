import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { type Body, type Verb, wait, walkTo } from '@drawcall/animate';
import type { Beat } from '.';
import { DAIS } from '../hall';
import { createMedal } from '../medal';
import { createMedalStand, follow, hangMedal, lookingAtGiver, readyMedals, type Receiving, takeMedal } from '../ceremony';
import { bowForMedal, cockyWink, stepBackAndNod } from '../gestures';

/**
 * The medal presentation: the heroes stand on the step below the dais, facing Leia. The officer beside her takes up the two medals from
 * their stand and holds them ready; she takes the first from him, steps up to Luke, raises it over his head and hangs it round his neck
 * as he bows, and steps back; then she takes the second and does the same for Han, who winks at her. Everyone watches the medals.
 */
export const beat: Beat & { order: number } = {
  id: 'ceremony',
  title: 'The medals: Leia hangs a medal round Luke’s neck, then Han’s',
  order: 45,
  duration: 60,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ scene, marks, cast }) {
    const { luke, han, chewbacca, leia, medalBearer: bearer, dodonna, threepio, artoo } = cast;
    const medals = [createMedal('Luke’s medal'), createMedal('Han’s medal')] as const;
    // the stand at the bearer's right front (he faces the doors, so his right is +x), its front, the medallions' side, away from him
    const standAt = new Vector3(marks.medalBearer.position.x + 0.55, DAIS.height, marks.medalBearer.position.z - 0.25);
    const away = standAt.clone().sub(marks.medalBearer.position);
    const { stand, rests } = createMedalStand(standAt, Math.atan2(away.x, away.z));
    scene.add(stand);
    medals.forEach((medal, index) => rests[index].add(medal));
    // where Leia steps back to after hanging each medal: a short step back from the dais's edge, still facing the doors
    const backFrom = (hero: Body) => {
      const back = new Object3D();
      back.name = 'stepped back';
      back.position.set(hero.position.x * 0.8, DAIS.height, marks.lukeDecorated.position.z + 0.95);
      back.rotation.y = Math.PI;
      scene.add(back);
      return back;
    };

    let phase: 'ready' | 'luke' | 'han' | 'done' = 'ready';
    /** the hero whose own part has his eyes now */
    let receiving: Body | undefined;
    const outcome = { ready: false, took: [false, false], hung: [false, false] };
    // what each onlooker watches: Leia, and each medal from the hand-over until it is on its hero (whose eyes are his own part's then);
    // Leia herself looks at Luke before and after, her eyes her verbs' in between, and the bearer's are his verbs' while he holds a medal
    const focus = (onlooker: Body): Object3D | Body | undefined => {
      if (onlooker === receiving) return undefined;
      if (onlooker === leia) return phase === 'ready' || phase === 'done' ? luke : undefined;
      if (onlooker === bearer && medals.some((medal) => bearer.holds(medal))) return undefined;
      if (phase === 'ready' || phase === 'done') return leia;
      const medal = medals[phase === 'luke' ? 0 : 1];
      const handedOver = leia.holds(medal) || (bearer.holds(medal) && onlooker !== luke && onlooker !== han);
      return handedOver ? medal : leia;
    };

    function* present(hero: Body, index: 0 | 1, receive: Receiving): Verb {
      phase = index === 0 ? 'luke' : 'han';
      outcome.took[index] = yield* takeMedal(leia, bearer, medals[index]);
      if (!outcome.took[index]) return false;
      // he steps back to his place as she takes it to the hero
      yield* parallel('all', walkTo(bearer, marks.medalBearer, { speed: 0.6 }), function* () {
        outcome.hung[index] = yield* hangMedal(leia, hero, medals[index], backFrom(hero), {
          *receive(hung) {
            receiving = hero;
            const received = yield* receive(hung);
            receiving = undefined;
            return received;
          },
          stepBack: stepBackAndNod,
        });
      });
      return outcome.hung[index];
    }

    function* story() {
      yield* parallel('race', follow([luke, han, chewbacca, dodonna, threepio, artoo, bearer, leia], focus, Infinity), function* () {
        outcome.ready = yield* readyMedals(bearer, medals);
        if (!outcome.ready) return;
        // Luke bows as she hangs his (gestures.ts)
        if (!(yield* present(luke, 0, (hung) => bowForMedal(luke, leia, hung)))) return;
        // Han looks at her, his head inclined for it, then winks once it is on (gestures.ts)
        yield* present(han, 1, function* (hung) {
          yield* lookingAtGiver(han, leia)(hung);
          return yield* cockyWink(han, leia);
        });
        phase = 'done';
        // she returns to her place
        yield* walkTo(leia, marks.leia, { speed: 0.5 });
        yield* wait(1);
      });
    }
    return {
      story,
      done: () =>
        outcome.ready && outcome.hung.every(Boolean) && medals.every((medal, index) => medal.parent?.name === 'medal worn' && [luke, han][index].object.getObjectById(medal.parent.id) !== undefined),
    };
  },
};
