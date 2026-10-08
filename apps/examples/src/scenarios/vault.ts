import { Box3, MathUtils } from 'three';
import type { Scenario } from '../scenario';
import { vec } from '../math';

const { clamp, smoothstep } = MathUtils;

/** the wall along +z (m): its near face, depth, width and height (waist high) */
const WALL = { at: 10, depth: 0.3, width: 2, height: 1 };
/** where the walk-to point comes to rest (m along z), and the jog it speeds up to (m/s) */
const END = 19;
const JOG = 3;

export const vault: Scenario = {
  id: 'vault',
  title: 'Vaulting a waist-high wall',
  drives: 'a walk-to point + a wall (a floor obstacle)',
  description:
    'A walk-to point speeds up from a walk to a jog straight over a wall 1 m high and 30 cm deep — too tall to step over, too high to jump onto. Nobody scripts the vault: the body runs on at it, takes off from a footfall within reach, plants its left hand on the top as the right arm swings up, passes the hips just over it with the trunk leaning onto the hand and the legs swept over to the right, reaches down beyond it with the lead leg, lands and runs on.',
  duration: 10,
  actors: [{ maxSpeed: 3.4, accel: 2.4 }],
  cameraDistance: 5,
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    const wall = new Box3(vec(-WALL.width / 2, 0, WALL.at), vec(WALL.width / 2, WALL.height, WALL.at + WALL.depth));
    return {
      inputs(t, dt) {
        // (a walk, then a jog, easing into its stop)
        const speed = 1.2 * smoothstep(t, 0.6, 2) + (JOG - 1.2) * smoothstep(t, 3, 5);
        s += speed * clamp((END - s) / 2.5, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, floorObstacles: [wall] }];
      },
      props: () => [{ kind: 'box', position: wall.getCenter(vec(0, 0, 0)), size: wall.getSize(vec(0, 0, 0)) }],
    };
  },
};
