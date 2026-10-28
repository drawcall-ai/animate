import { Object3D, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { carry, grab, lookAt, release, wait, walkTo, type Body } from '@drawcall/animate';
import type { Beat } from './index';

// The medals: the officer beside Leia holds out each medal, Leia takes it from him and hangs it on the hero before her, Luke first,
// then Han. Each medal changes hands without teleporting (the bearer keeps hold until Leia has it) and ends worn: attached to an empty
// at the front of the hero's chest, which follows his chest bone.

/**
 * a medal on its ribbon: 0.1 kg. The bearer holds it near the medal (empties `inner left` and `inner right`, 0.08 m apart); Leia takes
 * the ribbon further out (`outer left` and `outer right`, 0.3 m apart), so two people's hands never share a grip.
 */
function createMedal(name: string): Object3D {
  const medal = new Object3D();
  medal.name = name;
  medal.userData.mass = 0.1;
  for (const [name, x] of [['inner left', 0.04], ['inner right', -0.04], ['outer left', 0.15], ['outer right', -0.15]] as const) {
    const grip = new Object3D();
    grip.name = name;
    grip.position.x = x;
    medal.add(grip);
  }
  return medal;
}

/** where a medal hangs on `hero`: an empty 0.15 m in front of his chest bone, turned as he faces, attached to that bone */
function createWornPlace(hero: Body, name: string): Object3D {
  const place = new Object3D();
  place.name = name;
  const chest = hero.bones.chest;
  chest.updateWorldMatrix(true, false);
  chest.getWorldPosition(place.position).add(new Vector3(Math.sin(hero.facing), 0, Math.cos(hero.facing)).multiplyScalar(0.15));
  place.rotation.y = hero.facing;
  chest.attach(place);
  return place;
}

/** a point in front of `body` (m ahead, m up from its floor) */
function ahead(body: Body, distance: number, height: number): Vector3 {
  return new Vector3(Math.sin(body.facing) * distance, height, Math.cos(body.facing) * distance).add(body.position);
}

export const beat: Beat & { order: number } = {
  id: 'ceremony',
  title: 'The medals',
  order: 5,
  duration: 60,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ scene, marks, cast }) {
    const { luke, han, chewbacca, leia, medalBearer: bearer } = cast;
    const medals = [createMedal('luke medal'), createMedal('han medal')];
    // the medals wait on a tray the bearer holds in front of him at waist height
    const tray = new Object3D();
    tray.name = 'medal tray';
    tray.position.copy(ahead(bearer, 0.35, 0.95));
    tray.rotation.y = bearer.facing;
    scene.add(tray);
    medals.forEach((medal, i) => {
      medal.position.set((i - 0.5) * 0.2, 0, 0);
      tray.add(medal);
    });
    const worn = [createWornPlace(luke, 'luke medal place'), createWornPlace(han, 'han medal place')];

    /** the bearer offers `medal`, Leia takes it from him and hangs it on `hero` while he bows his head to it */
    function* decorate(hero: Body, medal: Object3D, place: Object3D) {
      // the bearer takes the medal up while Leia comes back to her place beside him (from the hero she decorated before)
      yield* parallel('all', walkTo(leia, marks.leia), function* () {
        if (!(yield* grab(bearer, medal, { left: 'inner left', right: 'inner right' }))) throw new Error(`the bearer could not take ${medal.name}`);
      });
      // he holds it out toward her from where he stands, 0.4 m his way to her; she takes it by the ribbon's outer ends (her right on
      // its left, facing him) and he lets go. Placed halfway between them, he walked into her space and her hands could not get in.
      const offer = new Vector3().subVectors(leia.position, bearer.position).setY(0).setLength(0.4).add(bearer.position).setY(bearer.position.y + 1.1);
      yield* parallel('race', carry(bearer, medal, offer, { until: Infinity }), function* () {
        yield* wait(0.8);
        if (!(yield* grab(leia, medal, { left: 'outer right', right: 'outer left' }))) throw new Error(`Leia could not take ${medal.name}`);
        if (!leia.holds(medal)) throw new Error(`Leia has no hold of ${medal.name}`);
      });
      release(bearer, medal);
      // she hangs it on him; he bows his head to the ribbon as it comes and looks up at her once it is on
      yield* parallel('race', lookAt(hero, ahead(hero, 0.5, 1.1)), function* () {
        if (!(yield* carry(leia, medal, place))) throw new Error(`Leia could not hang ${medal.name}`);
      });
      release(leia, medal, place);
      yield* lookAt(hero, leia.bones.head, { until: 1.2 });
    }

    const story = function* () {
      // the heroes look up at Leia while she is busy; Chewbacca waits his turn
      yield* parallel('race', lookAt(chewbacca, leia.bones.head), function* () {
        yield* decorate(luke, medals[0], worn[0]);
        yield* decorate(han, medals[1], worn[1]);
      });
      // Chewbacca throws his head back and roars
      yield* lookAt(chewbacca, ahead(chewbacca, 1, 4), { until: 1.5 });
    };

    return {
      story,
      done: () => medals.every((medal, i) => medal.parent === worn[i]) && ![bearer, leia].some((body) => medals.some((medal) => body.holds(medal))),
    };
  },
};
