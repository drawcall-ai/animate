import { Group, Vector3 } from 'three';
import { dog, grab, walkTo } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { DOG } from '../skeletons';
import { ball } from '../things';

/** where the ball lies, and where the dog brings it back to (m) */
const BALL = new Vector3(4, 0.04, 4);
const BACK = new Vector3(0, 0, 0.5);

/** A dog trots to a ball, takes it in its jaw and carries it back. */
export function dogFetch(): Scenario {
  return {
    id: 'dog-fetch',
    title: 'A dog fetches a ball',
    description: 'A Labrador trots to a ball 5.7 m away (diagonal pairs, its whole body riding on the trot), takes it in its jaw and carries it back.',
    duration: 22,
    cameraDistance: 3,
    cameraAngles: { side: Math.PI / 2 },
    stage: (cast) => {
      const labrador = cast.body(dog(DOG));
      const scene = new Group();
      const toy = ball(scene, 'ball', 0.04, BALL);
      toy.userData.mass = 0.06;
      // (taken as the jaw comes: a ball has no one way to hold it)
      toy.userData.free = true;
      let back = false;
      return {
        scene,
        bodies: [labrador],
        story: function* () {
          yield* grab(labrador, toy, { jaw: 'ball' });
          back = yield* walkTo(labrador, BACK);
        },
        done: () => back && labrador.holds(toy),
      };
    },
  };
}
