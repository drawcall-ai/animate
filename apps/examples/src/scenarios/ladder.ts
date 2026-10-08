import { Box3, MathUtils } from 'three';
import type { Ladder } from '@prohuman/core';
import type { Scenario } from '../scenario';
import { jointOf } from '../joints';
import { vec } from '../math';

/** a platform 3 m up along +z (m): its near face, depth, width; the ladder's rungs this far out from its face (toe room) and its stiles this far above it */
const PLATFORM = { at: 3, depth: 2, width: 3, height: 3 };
const TOE_ROOM = 0.18;
const RAILS = 1;
/** where the walk-to point comes to rest: on the platform, this far in from its edge (m) */
const END = 1;

export const ladder: Scenario = {
  id: 'ladder',
  title: 'Climbing a ladder',
  drives: 'a walk-to point + a ladder + the platform (a ground box)',
  description:
    'A walk-to point moves onto a platform 3 m up; a ladder with 30 cm rungs leads up its face. Nobody scripts the limbs: the walk stops at the foot of the ladder facing it, the hands take hold of the rungs, and the body climbs hand and opposite foot together, each up two rungs as it rises one, the trunk close to the rungs; near the top the hands move onto the stiles, one foot steps through onto the platform, the other follows as the hands let go, and it stands and walks on.',
  duration: 16,
  actors: [{}],
  // (the camera rises with the body)
  focus: (a) => jointOf(a[0], 'hips'),
  cameraDistance: 4.5,
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    const platform = new Box3(vec(-PLATFORM.width / 2, 0, PLATFORM.at), vec(PLATFORM.width / 2, PLATFORM.height, PLATFORM.at + PLATFORM.depth));
    const rungs: Ladder = { position: vec(0, 0, PLATFORM.at - TOE_ROOM), yaw: 0, height: PLATFORM.height };
    const end = PLATFORM.at + END;
    return {
      inputs(t, dt) {
        // (easing into its stop, like someone arriving somewhere)
        s += 1.0 * MathUtils.smoothstep(t, 0.5, 1.8) * MathUtils.clamp((end - s) / 1.2, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, ground: [platform], ladders: [rungs] }];
      },
      props: () => [
        { kind: 'box', position: platform.getCenter(vec(0, 0, 0)), size: platform.getSize(vec(0, 0, 0)) },
        { kind: 'ladder', ladder: rungs, rails: RAILS },
      ],
    };
  },
};
