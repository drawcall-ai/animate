import { Group, MathUtils, Vector3 } from 'three';
import { walkTo } from '@drawcall/animate';
import type { Person, Scenario } from '../src/scenario';

/**
 * A walk from standing at the origin facing +Z to a point on the floor (and a facing there): judged as a stroll, done once the walk
 * has ended there.
 */
export function walkThere(to: Vector3, face?: number): Scenario {
  return {
    id: 'stroll',
    title: 'Walk there',
    description: 'From standing, the body walks to a point (behind it, beside it, or where it stands, turning round) and comes to rest there.',
    duration: 8,
    stage: (cast) => {
      const walker = cast.person();
      let arrived = false;
      return {
        scene: new Group(),
        bodies: [walker],
        story: function* () {
          arrived = yield* walkTo(walker, to, { face });
        },
        done: () => arrived && walker.settled && standsAt(walker, to) && (face === undefined || Math.abs(MathUtils.euclideanModulo(walker.facing - face + Math.PI, 2 * Math.PI) - Math.PI) < 0.15),
      };
    },
  };
}

/** whether `walker`'s centre of mass stands over `point` (within 15 cm) */
const standsAt = (walker: Person, point: Vector3) => walker.pose.com(new Vector3()).setY(0).distanceTo(point) < 0.15;
