import { parallel } from '@pmndrs/timeline';
import { wait, type Body } from '@drawcall/animate';
import type { Beat } from './index';
import { createTroops, HEROES, serve } from '../troops';

/** how long the troops stand at attention before the trio turns to the hall, and how long they applaud (s) */
const ATTENTION = 4;
const APPLAUSE = 8;

/** The troops at attention either side of the aisle; at the finale they turn to the heroes on the steps and applaud. */
export const beat: Beat & { order: number } = {
  id: 'troops',
  title: 'The troops: attention, then applause',
  order: 2,
  duration: ATTENTION + APPLAUSE + 2,
  starts: { luke: 'lukeDecorated', han: 'hanDecorated', chewbacca: 'chewbaccaDecorated' },
  stage({ scene, dress, checkCrowds }) {
    const troops = createTroops(dress, checkCrowds);
    scene.add(troops.echoes);
    const bodies = troops.troopers.map((trooper) => trooper.body);
    let cued = false;
    // at the end: every trooper faces the steps with its hands busy applauding or cheering
    let applauding = false;
    return {
      extras: bodies,
      story: function* () {
        yield* parallel(
          'race',
          troops.replay(),
          ...troops.troopers.map((trooper) => serve(trooper, () => cued)),
          function* () {
            yield* wait(ATTENTION);
            cued = true;
            yield* wait(APPLAUSE);
            applauding = bodies.every((body) => facesSteps(body) && (body.owners.hands.left ?? body.owners.hands.right) !== undefined);
          },
        );
      },
      done: () => applauding,
    };
  },
};

/** whether `body` faces the trio on the steps within 25 degrees */
function facesSteps(body: Body): boolean {
  const toward = Math.atan2(HEROES.x - body.position.x, HEROES.z - body.position.z);
  return Math.abs(Math.atan2(Math.sin(toward - body.facing), Math.cos(toward - body.facing))) < (25 * Math.PI) / 180;
}
