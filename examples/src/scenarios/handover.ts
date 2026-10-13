import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { createWorld, follow, followRotation, INDEX, relaxedPose, solveChain, type Frame, type World } from '@drawcall/animate';
import type { Prop, Scenario } from '../scenario';

// The layering of behaviours, bare: a stand, a reach over it, and an override over that, each
// moving its bones on from where they are.

/** the circle the right hand traces in front of the chest (world, the body at the origin facing +Z): centre, radius (m), period (s) */
const CIRCLE = { centre: new Vector3(-0.2, 1.2, 0.35), radius: 0.12, period: 2.5 };
/** where the override raises the hand, from `OVERRIDE[0]` for `OVERRIDE[1]` s */
const RAISED = new Vector3(-0.35, 1.8, 0.15);
const OVERRIDE = [4, 2] as const;
/** how fast the hand moves (m/s², m/s) and the stand turns its joints back (rad/s²) */
const HAND = { accel: 8, speed: 1.5 };
const STAND = { accel: 30 };
const STILL = new Vector3();

/** the circle's point at `t` (and its velocity) */
function circle(t: number, at: Vector3, velocity: Vector3) {
  const w = (2 * Math.PI) / CIRCLE.period;
  const [c, s] = [Math.cos(w * t), Math.sin(w * t)];
  at.set(0, CIRCLE.radius * c, CIRCLE.radius * s).add(CIRCLE.centre);
  velocity.set(0, -CIRCLE.radius * w * s, CIRCLE.radius * w * c);
}

/** the right hand moved toward `goal` (moving at `velocity`) as fast as a hand, from where it has been moving; the elbow stays turned as it is */
function reach(f: Frame<World>, goal: Vector3, velocity: Vector3) {
  const hand = follow(f.prev2.position(INDEX.rightHand), f.prev.position(INDEX.rightHand), goal, { ...HAND, velocity }, f.dt, _hand);
  solveChain(f, 'rightArm', { tip: { position: hand } });
}

const _hand = new Vector3();

export const handOver: Scenario = {
  id: 'hand-over',
  title: 'Layers: a hand handed over',
  description:
    'Three layers: the body stands relaxed; over that the right hand traces a circle; from 4 s to 6 s a later layer raises the hand instead. The left arm hangs. Each hand-over is continuous: every layer moves its bones on from the motion they have.',
  duration: 10,
  actors: [{}],
  world: () => createWorld(),
  props: (t) => {
    const at = new Vector3();
    circle(t, at, new Vector3());
    const targets: Prop[] = [{ kind: 'ball', position: at, radius: 0.03 }];
    if (t >= OVERRIDE[0] && t < OVERRIDE[0] + OVERRIDE[1]) targets.push({ kind: 'ball', position: RAISED.clone(), radius: 0.03 });
    return targets;
  },
  script: () =>
    function* () {
      const relaxed = relaxedPose();
      const turned = new Quaternion();
      const goal = new Vector3();
      const velocity = new Vector3();
      yield* parallel<Frame<World>>(
        'all',
        // the stand: every joint back to the relaxed pose
        action<Frame<World>>({
          update: (f) => {
            for (const { bone, rotation } of relaxed) f.current.setLocal(bone, followRotation(f.prev2.local(bone), f.prev.local(bone), rotation, STAND, f.dt, turned));
          },
        }),
        // over it: the right hand on the circle
        action<Frame<World>>({
          update: (f) => {
            circle(f.time, goal, velocity);
            reach(f, goal, velocity);
          },
        }),
        // over that, for a while: the right hand raised
        function* () {
          yield* action({ until: timePassed(OVERRIDE[0], 'seconds') });
          yield* action<Frame<World>>({ update: (f) => reach(f, RAISED, STILL), until: timePassed(OVERRIDE[1], 'seconds') });
        },
      );
    },
};
