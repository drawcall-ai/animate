import { Box3, MathUtils } from 'three';
import type { Scenario } from '../scenario';
import { jointOf } from '../joints';
import { vec } from '../math';

/** the box (m): its near face along +z, width, depth and height — taller than the body */
const BOX = { at: 2.5, width: 1.2, depth: 1.5, height: 2 };
/** where the walk-to point comes to rest: on the top, this far in from the near edge (m) */
const END = 0.8;

export const climb: Scenario = {
  id: 'climb',
  title: 'Climbing onto a 2 m box',
  drives: 'a walk-to point + a ground box',
  description:
    'A walk-to point moves onto the top of a box 2 m tall, higher than the body; the box is ground to stand on. Nobody scripts the climb: the walk stops facing the wall, the body sinks and hops with the arms swinging up, catches the edge with both hands, hangs with the feet on the wall, pulls up as the feet walk up the face, rolls the hands over onto the top and presses up, brings one foot up beside the hands, puts its weight on it, brings the other up, stands and walks on to the point.',
  duration: 11,
  actors: [{}],
  // (the camera rises with the body)
  focus: (a) => jointOf(a[0], 'hips'),
  cameraDistance: 5,
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    const box = new Box3(vec(-BOX.width / 2, 0, BOX.at), vec(BOX.width / 2, BOX.height, BOX.at + BOX.depth));
    const end = BOX.at + END;
    return {
      inputs(t, dt) {
        // (easing into its stop, like someone arriving somewhere)
        s += 1.0 * MathUtils.smoothstep(t, 0.5, 1.8) * MathUtils.clamp((end - s) / 1.2, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, ground: [box] }];
      },
      props: () => [{ kind: 'box', position: box.getCenter(vec(0, 0, 0)), size: box.getSize(vec(0, 0, 0)) }],
    };
  },
};
