import { Object3D } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, lookAt, reach, wait, walkTo, type Body, type Verb } from '@drawcall/animate';
import { besides, bowForMedal, cockyWink, eyesOf, graciousNod, roar, stepBackAndNod } from '../gestures';
import { floorAt } from '../hall';
import type { Beat } from './index';

// The medal moment's gestures on their own, without the medals: Leia comes before Luke and puts her hands up to his neck as if hanging
// one, while he bows his head to it; she steps back and nods to him. She moves on to Han, who gives her his cocky wink as she finishes,
// and she steps back and nods again. Chewbacca throws his head back and roars; Leia turns her nod to him.
//
// The library stands every body on the plane y = 0 (it has no raised floor). After each step this beat lifts each body's object by the
// floor height under it, so it is seen on its step; the motion is still worked out on y = 0, so whatever one body aims at on another
// (eyes, a neck) is shifted by the difference of their floors (0.2 m between the heroes' step and Leia's dais).

/** how long her hands are at his neck (s) */
const HANGING = 2.4;

/**
 * where `giver` stands to hang a medal on `hero`: in front of him, facing him, as far as her wrists reach his neck with the arms
 * comfortably bent (85% of their length, plus the 0.08 m the ribbon sits before his neck and a little for her shoulders). Further
 * and the reach draws her in a step while her hands are up; nearer and she leans in from the hips. Never nearer than 0.45 m, where
 * the two bodies would meet.
 */
function before(hero: Body, giver: Body): Object3D {
  const arm = giver.species.person?.armLength;
  if (arm === undefined) throw new Error('the giver needs arms (a person-shaped body)');
  const mark = new Object3D();
  mark.position.copy(besides(hero, 0, 0, Math.max(0.45, 0.13 + 0.85 * arm)));
  mark.rotation.y = hero.facing + Math.PI;
  return mark;
}

/**
 * Leia's hands lift a ribbon up in front of `hero`'s face (any higher and she must stretch past what her arms reach from where she
 * stands), then bring it down either side of his neck and hold it there; `HANGING` seconds in all
 */
function hangMedal(leia: Body, hero: Body): Verb {
  const person = hero.species.person;
  if (!person) throw new Error('a medal hangs on a person-shaped body');
  // his body's heights as she must reach for them: lower by the height her dais stands above his step
  const below = floorAt(leia.position.z) - floorAt(hero.position.z);
  const over = person.eyeHeight - 0.05 - below, neck = person.shoulderHeight + 0.08 - below;
  return (function* () {
    yield* reach(leia, { left: besides(hero, -0.13, over, 0.18), right: besides(hero, 0.13, over, 0.18) }, { until: HANGING * 0.4 });
    return yield* reach(leia, { left: besides(hero, -0.12, neck, 0.08), right: besides(hero, 0.12, neck, 0.08) }, { until: HANGING * 0.6 });
  })();
}

/** `body` keeps its eyes on `other` (following them as they move) until its story moves on */
function watching(body: Body, other: Body): Verb {
  return lookAt(body, () => eyesOf(other, body));
}

export const beat: Beat & { order: number } = {
  id: 'gestures',
  title: 'The gestures',
  order: 6,
  duration: 40,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ scene, cast }) {
    const { luke, han, chewbacca, leia } = cast;
    const marks = { luke: before(luke, leia), han: before(han, leia) };
    scene.add(marks.luke, marks.han);
    const done = { luke: false, han: false, chewbacca: false };

    const story = function* () {
      yield* wait(0.8);
      // Luke: Leia comes down to him; he watches her come, then bows as her hands go to his neck, and looks up at her as she steps back
      yield* parallel('race', watching(han, leia), watching(chewbacca, leia), function* () {
        // her hands go up as she arrives: the walk's own settling (about 1.5 s after the last step) need not hold them back
        yield* parallel('all', walkTo(leia, marks.luke, { speed: 0.7 }), (function* () {
          yield* lookAt(luke, () => eyesOf(leia, luke), { until: arriving(leia, 0.4) });
          let hung = false;
          yield* parallel(
            'all',
            bowForMedal(luke, leia, { until: () => hung }),
            (function* () {
              yield* hangMedal(leia, luke);
              hung = true;
              done.luke = yield* stepBackAndNod(leia, luke);
            })(),
          );
        })());
      });
      // Han: she moves on to him; as her hands come down from his neck he turns his wink on her
      yield* parallel('race', watching(luke, leia), watching(chewbacca, leia), function* () {
        const walk = walkTo(leia, marks.han, { speed: 0.7 });
        yield* parallel('all', walk, (function* () {
          yield* lookAt(han, () => eyesOf(leia, han), { until: arriving(leia, 0.4) });
          yield* parallel('all', lookAt(han, () => eyesOf(leia, han), { until: HANGING - 0.6 }), hangMedal(leia, han));
        })());
        yield* parallel('all', cockyWink(han, leia), stepBackAndNod(leia, han));
        done.han = true;
      });
      // Chewbacca roars; the others turn to him, and Leia gives him her nod as he settles
      yield* parallel('race', watching(luke, chewbacca), watching(han, chewbacca), function* () {
        yield* parallel('all', lookAt(leia, () => eyesOf(chewbacca, leia), { until: 0.8 }), wait(0.3));
        yield* parallel(
          'all',
          (function* () {
            done.chewbacca = yield* roar(chewbacca);
          })(),
          (function* () {
            yield* lookAt(leia, () => eyesOf(chewbacca, leia), { until: 2.4 });
            yield* graciousNod(leia, chewbacca);
          })(),
        );
      });
      yield* wait(1.5);
    };

    const bodies = Object.values(cast);
    const afterStep = () => {
      for (const body of bodies) body.object.position.y = floorAt(body.position.z);
    };
    return { story, afterStep, done: () => done.luke && done.han && done.chewbacca };
  },
};
