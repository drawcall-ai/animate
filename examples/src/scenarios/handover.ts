import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { createWorld, follow, INDEX, relaxedPose, solveChain, type Frame, type Humanoid, type World } from '@drawcall/animate';
import type { Scenario } from '../scenario';

// The layering of behaviours, bare: a stand, a reach over it, and an override over that.

/** the circle the hand traces in front of the chest: its centre off the right shoulder (body frame, m at 1.75 m), radius, period (s) */
const CIRCLE = { centre: new Vector3(-0.05, -0.2, 0.35), radius: 0.12, period: 2.5 };
/** where the override raises the hand, off the right shoulder (body frame) */
const RAISED = new Vector3(-0.2, 0.4, 0.15);
/** the elbow points out, down and back (body frame, off the shoulder) */
const POLE = new Vector3(-0.5, -0.6, -0.4);
const HAND = { accel: 8, speed: 1.5 };
const STILL = new Vector3();

/** an offset in the body's frame (its hips' turn), scaled to its height, off the right shoulder of `f.prev` */
function offShoulder(h: Humanoid<World>, f: Frame<World>, offset: Vector3, out: Vector3) {
  return out
    .copy(offset)
    .multiplyScalar(h.proportions.scale)
    .applyQuaternion(f.prev.rotation(0))
    .add(f.prev.position(INDEX.rightUpperArm));
}

/** the right hand moved toward `goal` (moving at `velocity`) at most as fast as a hand, from where it has been moving */
function reach(h: Humanoid<World>, f: Frame<World>, goal: Vector3, velocity: Vector3) {
  const hand = follow(f.prev2.position(INDEX.rightHand), f.prev.position(INDEX.rightHand), goal, { ...HAND, velocity }, f.dt, _hand);
  solveChain(f, 'rightArm', { tip: { position: hand }, pole: offShoulder(h, f, POLE, _pole) });
  (h.status.intent.rightHand ??= { position: new Vector3(), weight: 1 }).position.copy(goal);
}

const _hand = new Vector3();
const _pole = new Vector3();

export const handOver: Scenario = {
  id: 'hand-over',
  title: 'Layers: a hand handed over',
  description:
    'Three layers: the body stands relaxed; over that the right hand traces a circle; from 4 s to 6 s a later layer raises the hand instead. The left arm hangs. Each hand-over is continuous: the hand starts from the motion it has.',
  duration: 10,
  actors: [{}],
  world: () => createWorld(),
  props: () => [],
  script: (h) =>
    function* () {
      const relaxed = relaxedPose();
      const centre = new Vector3();
      const goal = new Vector3();
      const velocity = new Vector3();
      const raised = new Vector3();
      yield* parallel<Frame<World>>(
        'all',
        action<Frame<World>>({
          update: (f) => {
            for (const { bone, rotation } of relaxed) f.current.setLocal(bone, rotation);
          },
        }),
        action<Frame<World>>({
          update: (f) => {
            const w = (2 * Math.PI) / CIRCLE.period;
            const r = CIRCLE.radius * h.proportions.scale;
            const [c, s] = [Math.cos(w * f.time), Math.sin(w * f.time)];
            offShoulder(h, f, CIRCLE.centre, centre);
            // (in the body's sagittal plane: up and forward)
            goal.set(0, r * c, r * s).applyQuaternion(f.prev.rotation(0)).add(centre);
            velocity.set(0, -r * w * s, r * w * c).applyQuaternion(f.prev.rotation(0));
            reach(h, f, goal, velocity);
          },
        }),
        function* () {
          yield* action({ until: timePassed(4, 'seconds') });
          yield* action<Frame<World>>({ update: (f) => reach(h, f, offShoulder(h, f, RAISED, raised), STILL), until: timePassed(2, 'seconds') });
        },
      );
    },
};
