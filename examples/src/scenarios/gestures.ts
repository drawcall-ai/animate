import { Group, Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { lookAt, pose, wait, type Body } from '@drawcall/animate';
import type { Scenario } from '../scenario';

/** where `body`'s eyes are now (world): what another looks at to look it in the eye */
function eyesOf(body: Body): () => Vector3 {
  const eyes = new Vector3();
  return () => {
    const gaze = body.species.gaze;
    if (!gaze) throw new Error('a body with no eyes to look into');
    return gaze.eyes(body.pose, eyes);
  };
}

export const gestures: Scenario = {
  id: 'gestures',
  title: 'Nod, bow, roar',
  description: 'Face to face, one greets the other with a nod, bows low, throws the head back with the chest lifting, then gives a cocky tilt of the head.',
  duration: 13,
  stage: (cast) => {
    const greeter = cast.person();
    const watcher = cast.person({ at: new Vector3(0, 0, 1.8), face: Math.PI });
    let finished = false;
    return {
      scene: new Group(),
      bodies: [greeter, watcher],
      story: function* () {
        yield* parallel('race', lookAt(watcher, eyesOf(greeter)), function* () {
          // (its eyes on the other's through the greeting and the bow, whatever its head and trunk do)
          yield* parallel('race', lookAt(greeter, eyesOf(watcher)), function* () {
            yield* wait(1);
            // a nod: the head dips 0.3 rad (17°) and comes back as the pose ends
            yield* pose(greeter, { head: { pitch: 0.3 } }, { until: 0.4 });
            yield* wait(1.5);
            // a low bow: the trunk 0.5 rad forward at the hips and back, the head down another 0.35 on it, held, then up again
            yield* pose(greeter, { bow: 0.5, head: { pitch: 0.35 } }, { until: 1.8 });
            yield* wait(1.5);
          });
          // a roar, the eyes let go: the back arched 0.3 rad, the chest lifting, and the head thrown back 0.7 more
          yield* pose(greeter, { bow: -0.3, head: { pitch: -0.7 } }, { until: 2 });
          yield* wait(1.2);
          // a cocky tilt as it looks at the other again: the head tipped 0.3 rad toward its right shoulder, the chin a little up
          yield* lookAt(greeter, eyesOf(watcher), { roll: 0.3, pitch: -0.1, until: 2 });
          yield* wait(1);
          finished = true;
        });
      },
      done: () => finished,
    };
  },
};
