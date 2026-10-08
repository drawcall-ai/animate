import { Box3, MathUtils } from 'three';
import type { Scenario } from '../scenario';
import { jointOf } from '../joints';
import { vec } from '../math';

/** a flight of stairs along +z (m): where it starts, the steps up and down, riser and tread (building code: ≤ 17.8 cm, ≥ 28 cm), the landing's depth, the width */
const STAIRS = { at: 2.5, steps: 4, riser: 0.17, tread: 0.28, landing: 1.2, width: 1.2 };
/** where the walk-to point comes to rest: this far past the foot of the stairs (m) */
const BEYOND = 2;

const { at, steps, riser, tread, landing, width } = STAIRS;

/** the steps as ground boxes: up to the landing, then down */
function flight(): Box3[] {
  const box = (z0: number, z1: number, h: number) => new Box3(vec(-width / 2, 0, z0), vec(width / 2, h, z1));
  const up = Array.from({ length: steps }, (_, i) => box(at + i * tread, at + (i + 1) * tread, (i + 1) * riser));
  const top = at + steps * tread;
  const down = Array.from({ length: steps - 1 }, (_, i) => box(top + landing + i * tread, top + landing + (i + 1) * tread, (steps - 1 - i) * riser));
  return [...up, box(top, top + landing, steps * riser), ...down];
}

export const stairs: Scenario = {
  id: 'stairs',
  title: 'Up and down stairs',
  drives: 'a walk-to point + ground boxes (the steps)',
  description:
    'A walk-to point moves at a walk over a flight of stairs — four 17 cm risers with 28 cm treads up to a landing, four down — given as ground boxes to stand on. Nobody scripts the steps: the walk slows to one step per tread, each foot rising over the nose of the step ahead and set down flat on its tread; going up the trunk leans a little forward and the body rises over the leading leg, going down it lowers on the standing leg and lands on the forefoot.',
  duration: 12,
  actors: [{}],
  // (the camera rises with the body)
  focus: (a) => jointOf(a[0], 'hips'),
  cameraDistance: 4,
  create() {
    let s = 0;
    const spot = vec(0, 0, 0);
    const ground = flight();
    const end = at + (2 * steps - 1) * tread + landing + BEYOND;
    return {
      inputs(t, dt) {
        // (easing into its stop, like someone arriving somewhere)
        s += 1.0 * MathUtils.smoothstep(t, 0.5, 1.8) * MathUtils.clamp((end - s) / 1.2, 0, 1) * dt;
        spot.set(0, 0, s);
        return [{ goal: { position: spot }, ground }];
      },
      props: () => ground.map((b) => ({ kind: 'box', position: b.getCenter(vec(0, 0, 0)), size: b.getSize(vec(0, 0, 0)) })),
    };
  },
};
