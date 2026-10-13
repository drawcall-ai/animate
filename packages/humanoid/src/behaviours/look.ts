import { Vector3 } from 'three';
import { action, type ReusableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '@prohuman/body';
import { INDEX } from '../bones';
import type { Humanoid } from '../humanoid';

/**
 * How a gaze is shared down the spine: how far each joint turns its forward from the pelvis's
 * toward the target (the chest a third of the way, the neck two thirds, the head all of it)
 */
const SHARE = { chest: 0.3, neck: 0.65, head: 1 } as const;
/**
 * how quickly each joint turns to it (Hz): the head first, the chest last. (Stiffer, the joints'
 * caps would set the pace, but a capped joint is pinned whole and the rest of the body swings to
 * make up for it: the timing is the springs'.)
 */
const STIFFNESS = { chest: 1.5, neck: 2.5, head: 4 } as const;

const FORWARD = new Vector3(0, 0, 1);
const ORIGIN = new Vector3();
const _from = new Vector3();
const _to = new Vector3();
const _at = new Vector3();

/**
 * Looking at `target` (a point in the world; null, nowhere in particular): the chest, neck and
 * head each aim their forward a share of the way from the pelvis's toward it, the head all the
 * way and first; reported in the intent.
 */
export function look<W>(h: Humanoid<W>, target: (ctx: Ctx<W>) => Readonly<Vector3> | null): ReusableTimeline<Ctx<W>> {
  const eyes = h.rig.points.eyes;
  return function* () {
    try {
      yield* action<Ctx<W>>({
        update: (ctx) => {
          const at = target(ctx);
          if (!at) {
            delete h.status.intent.lookAt;
            return;
          }
          (h.status.intent.lookAt ??= new Vector3()).copy(at);
          const pelvis = _from.copy(FORWARD).applyQuaternion(ctx.body.rotations[INDEX.hips]);
          for (const joint of ['chest', 'neck', 'head'] as const) {
            const point = joint === 'head' ? eyes : { bone: INDEX[joint], at: ORIGIN };
            const origin = ctx.body.point(point, _at);
            const toward = _to
              .subVectors(at, origin)
              .normalize()
              .lerp(pelvis, 1 - SHARE[joint])
              .add(origin);
            ctx.propose.target({ kind: 'aim', point, axis: FORWARD, value: toward, weight: 1, stiffness: STIFFNESS[joint], owner: 'look' });
          }
        },
      });
    } finally {
      delete h.status.intent.lookAt;
    }
  };
}
