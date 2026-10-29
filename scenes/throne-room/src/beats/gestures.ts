import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { arriving, carry, lookAt, reach, release, wait, walkTo, type Body, type Verb } from '@drawcall/animate';
import { besides, bowForMedal, cockyWink, graciousNod, roar, stepBackAndNod } from '../gestures';
import { floorAt } from '../hall';
import type { Beat, Setting, Staged } from './index';

// The medal moment's gestures: Leia comes before Luke and lifts a medal's ribbon up before his face and down over his neck, while he bows
// his head to it; she steps back and nods to him. She moves on to Han, who gives her his cocky wink as she finishes, and she steps back
// and nods again. Chewbacca throws his head back and roars; Leia turns her nod to him. On its own the beat has no medals: her hands go
// up to each neck as if hanging one; the film gives her real ones (`medalMoment`).

/** how long her hands are at his neck (s) */
const HANGING = 2.4;

/**
 * where `giver` stands to hang a medal on `hero`: in front of him, facing him, as far as her wrists reach his neck with the arms
 * comfortably bent (85% of their length, plus the 0.08 m the ribbon sits before his neck and a little for her shoulders). Further
 * and the reach draws her in a step while her hands are up; nearer and she leans in from the hips. Never nearer than 0.52 m: nearer, the two
 * bodies keep each other off and her walk there never ends.
 */
function before(hero: Body, giver: Body): Object3D {
  const arm = giver.species.person?.armLength;
  if (arm === undefined) throw new Error('the giver needs arms (a person-shaped body)');
  const mark = new Object3D();
  mark.position.copy(besides(hero, 0, 0, Math.max(0.52, 0.13 + 0.85 * arm)));
  mark.position.y = floorAt(mark.position.x, mark.position.z);
  mark.rotation.y = hero.facing + Math.PI;
  return mark;
}

/** a medal Leia holds for a hero, and the place on his chest it is to hang at */
export interface Medal {
  medal: Object3D;
  place: Object3D;
}

/**
 * Leia hangs a medal on `hero`, as a medal on a ribbon goes over a bowed head: her hands lift the ribbon's ends up before his face, over
 * the crown of his head, and down either side of his neck as the medal comes to rest on his chest; `HANGING` seconds in all. Holding
 * `held`, she carries it that way (the medal's path, its ends 0.26 m above it in her hands) onto its place and lets go of it there; without
 * a medal her hands make the same way through the air.
 */
export function hangMedal(leia: Body, hero: Body, held?: Medal): Verb {
  const person = hero.species.person, her = leia.species.person;
  if (!person || !her) throw new Error('a medal is hung by and on person-shaped bodies');
  const ribbon = 0.26;
  return (function* () {
    // she comes before him first, if she is not there yet (from where she stands she works out how high she can lift it)
    if (leia.position.distanceTo(hero.position) > 0.8 && !(yield* walkTo(leia, before(hero, leia), { speed: 0.7 }))) return false;
    // where the ribbon's ends go (in the hero's frame: ahead of him, up from his floor): raised before his face, a little above his eyes,
    // then in over his bowed head; each no higher than her hands reach comfortably (85% of her arm from her shoulders) from where she stands
    const ends = (ahead: number, up: number) => {
      const point = besides(hero, 0, up, ahead);
      const across = Math.hypot(point.x - leia.position.x, point.z - leia.position.z);
      const top = leia.position.y + her.shoulderHeight + Math.sqrt(Math.max(0, (0.85 * her.armLength) ** 2 - across ** 2));
      return point.setY(Math.min(point.y, top));
    };
    const raised = ends(0.26, person.eyeHeight + 0.12), over = ends(0.12, person.eyeHeight + 0.05);
    if (held) {
      // the medal's way hangs `ribbon` below its ends, and its ends are a little behind it (`createMedal`)
      const medalAt = (end: Vector3) => besides(hero, 0, 0, 0.04).sub(hero.position).add(end).setY(end.y - ribbon);
      if (!(yield* carry(leia, held.medal, [medalAt(raised), medalAt(over), held.place], { speed: 0.35, step: false }))) throw new Error(`Leia could not hang ${held.medal.name}`);
      release(leia, held.medal, held.place);
      return yield* wait(HANGING * 0.15);
    }
    const apart = (end: Vector3, x: number) => ({ left: besides(hero, -x, 0, 0).sub(hero.position).add(end), right: besides(hero, x, 0, 0).sub(hero.position).add(end) });
    yield* reach(leia, apart(raised, 0.12), { until: HANGING * 0.3 });
    yield* reach(leia, apart(over, 0.12), { until: HANGING * 0.3 });
    return yield* reach(leia, apart(besides(hero, 0, person.shoulderHeight + 0.1, 0.02), 0.11), { until: HANGING * 0.4 });
  })();
}

/** the medals Leia hangs: Luke's, which she holds as the moment begins, and Han's, which `takeHan` puts in her hands on her way to him */
export interface Medals {
  luke: Medal;
  han: Medal;
  takeHan: () => Verb;
}


export const beat: Beat & { order: number } = {
  id: 'gestures',
  title: 'The gestures',
  order: 6,
  duration: 40,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage: (setting) => medalMoment(setting),
};

/** the medal moment staged in `setting`, with real `medals` or without */
export function medalMoment({ scene, cast }: Setting, medals?: Medals): Staged {
  const { luke, han, chewbacca, leia } = cast;
  const marks = { luke: before(luke, leia), han: before(han, leia) };
  scene.add(marks.luke, marks.han);
  const done = { luke: false, han: false, chewbacca: false };

  const story = function* () {
    yield* wait(0.8);
    // Luke: Leia comes down to him; he watches her come, then bows as her hands go to his neck, and looks up at her as she steps back
    yield* parallel('race', lookAt(han, leia), lookAt(chewbacca, leia), function* () {
      // her hands go up as she arrives: the walk's own settling (about 1.5 s after the last step) need not hold them back
      yield* parallel('all', walkTo(leia, marks.luke, { speed: 0.7 }), (function* () {
        // he bows his head as she comes up to him, and her hands rise with the ribbon as she arrives
        yield* lookAt(luke, leia, { until: () => leia.position.distanceTo(luke.position) < 0.8 });
        let hung = false;
        yield* parallel(
          'all',
          bowForMedal(luke, leia, { until: () => hung }),
          (function* () {
            yield* wait(arriving(leia, 0.4));
            yield* hangMedal(leia, luke, medals?.luke);
            hung = true;
            done.luke = yield* stepBackAndNod(leia, luke);
          })(),
        );
      })());
    });
    // Han: she moves on to him; as her hands come down from his neck he turns his wink on her
    yield* parallel('race', lookAt(luke, leia), lookAt(chewbacca, leia), function* () {
      if (medals) yield* medals.takeHan();
      const walk = walkTo(leia, marks.han, { speed: 0.7 });
      yield* parallel('all', walk, (function* () {
        yield* lookAt(han, leia, { until: arriving(leia, 0.4) });
        yield* parallel('all', lookAt(han, leia, { until: HANGING - 0.6 }), hangMedal(leia, han, medals?.han));
      })());
      yield* parallel('all', cockyWink(han, leia), stepBackAndNod(leia, han));
      done.han = true;
    });
    // Chewbacca roars; the others turn to him, and Leia gives him her nod as he settles
    yield* parallel('race', lookAt(luke, chewbacca), lookAt(han, chewbacca), function* () {
      yield* parallel('all', lookAt(leia, chewbacca, { until: 0.8 }), wait(0.3));
      yield* parallel(
        'all',
        (function* () {
          done.chewbacca = yield* roar(chewbacca);
        })(),
        (function* () {
          yield* lookAt(leia, chewbacca, { until: 2.4 });
          yield* graciousNod(leia, chewbacca);
        })(),
      );
    });
    yield* wait(1.5);
  };

  return { story, done: () => done.luke && done.han && done.chewbacca };
}
