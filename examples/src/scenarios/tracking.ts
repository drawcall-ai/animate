import { Vector3, type Quaternion } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { createWorld, humanoid, track, type Ctx, type Effector, type Proportions, type World } from '@drawcall/animate';
import { scalar, track as keyed } from '../keys';
import { quatYXZ } from '../math';
import type { Scenario } from '../scenario';

// Keyframed trackers, like a VR headset: the head.

/** the standing skull-centre height the head tracks below were recorded at */
const RECORDED = 1.6;

/** Headset calibration: the factor from recorded heights to this body's. */
const heightScale = (p: Proportions) => (p.eyeHeight - p.eyes.y + p.headCenter.y) / RECORDED;

/** a head target: the eyes of a skull centred at `center`, turned by `q` (into `out`) */
function headAt(p: Proportions, center: Vector3, q: Quaternion, out: Effector) {
  out.position.copy(p.eyes).sub(p.headCenter).applyQuaternion(q).add(center);
  out.quaternion = q;
}

export const lookAround: Scenario = {
  id: 'look-around',
  title: 'Head tracking only',
  description:
    'Only a head pose is given (like a VR headset). Looking beyond the neck’s range turns the trunk and then the feet; lowering the head leans, then squats.',
  duration: 16,
  actors: [{}],
  world: () => createWorld(),
  props: () => [],
  script: (h) =>
    function* () {
      const back = -2.6;
      const [bx, bz] = [Math.sin(back), Math.cos(back)];
      const center = keyed([
        [0, [0, 1.6, 0.05]],
        [7, [0, 1.6, 0.05]],
        [8.5, [bx * 0.3, 1.42, bz * 0.3]],
        [9.6, [bx * 0.3, 1.42, bz * 0.3]],
        [11.2, [bx * 0.28, 1.0, bz * 0.28]],
        [12.2, [bx * 0.28, 1.0, bz * 0.28]],
        [13.8, [bx * 0.05, 1.6, bz * 0.05]],
      ]);
      const yaw = scalar([
        [0.5, 0],
        [2, 1.1],
        [3, 1.1],
        [4.5, -1.1],
        [5.2, -1.1],
        [6.8, back],
        [13.8, back],
        [15.5, 0],
      ]);
      const pitch = scalar([
        [7, 0],
        [8.5, 0.75],
        [9.6, 0.75],
        [11.2, 0.25],
        [12.2, 0.25],
        [13.8, 0],
      ]);
      const head: Effector = { position: new Vector3(), weight: 1 };
      const c = new Vector3();
      yield* parallel<Ctx<World>>(
        'all',
        humanoid(h),
        // the headset, as recorded, scaled to this body
        action<Ctx<World>>({
          update: ({ time: t }) => {
            center(t, c);
            c.y *= heightScale(h.proportions);
            headAt(h.proportions, c, quatYXZ(yaw(t), pitch(t)), head);
          },
        }),
        track(h, () => head),
      );
    },
};
