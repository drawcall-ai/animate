import { Quaternion, Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { Carrier, chainTo, createWorld, followRotation, relaxedPose, type Frame, type World } from '@drawcall/animate';
import type { Prop, Scenario } from '../scenario';
import { Report } from '../report';

// The layering of behaviours, bare: a stand, a reach over it, and an override over that, each
// moving its bones on from where they are.

/** the circle the ball traces in front of the chest (world, the body at the origin facing +Z): centre, radius (m), period (s) */
const CIRCLE = { centre: new Vector3(-0.2, 1.2, 0.35), radius: 0.12, period: 2.5 };
/** where the override raises the hand, from `OVERRIDE[0]` for `OVERRIDE[1]` s */
const RAISED = new Vector3(-0.35, 1.8, 0.15);
const OVERRIDE = [4, 2] as const;
/** how fast the hand moves (m/s², m/s) and the stand turns its joints back (rad/s²) */
const HAND = { accel: 8, speed: 1.5 };
const STAND = { accel: 30 };
const ORIGIN = { position: new Vector3() };

/** the circle's point at `t` */
const circle = (t: number, at = new Vector3()) => {
  const w = (2 * Math.PI) / CIRCLE.period;
  return at.set(0, CIRCLE.radius * Math.cos(w * t), CIRCLE.radius * Math.sin(w * t)).add(CIRCLE.centre);
};

export const handOver: Scenario = {
  id: 'hand-over',
  title: 'Layers: a hand handed over',
  description:
    'Three layers: the body stands relaxed; over that the right hand rides a ball going round a circle; from 4 s to 6 s a later layer raises the hand instead. The left arm hangs. Each hand-over is continuous: every layer moves its bones on from the motion they have.',
  duration: 10,
  actors: [{}],
  stage: () => {
    // (the ball: a carrier the stage moves before the body steps, the hand rides it)
    const ball = new Carrier(circle(0));
    const at = new Vector3();
    return {
      world: createWorld(),
      report: new Report(),
      move: (t) => ball.move(t, circle(t, at)),
      props: (t) => {
        const targets: Prop[] = [{ kind: 'ball', position: ball.current.position.clone(), radius: 0.03 }];
        if (t >= OVERRIDE[0] && t < OVERRIDE[0] + OVERRIDE[1]) targets.push({ kind: 'ball', position: RAISED.clone(), radius: 0.03 });
        return targets;
      },
      script: () =>
        function* () {
          const relaxed = relaxedPose();
          const turned = new Quaternion();
          yield* parallel<Frame<World>>(
            'all',
            // the stand: every joint back to the relaxed pose
            action<Frame<World>>({
              update: (f) => {
                for (const { bone, rotation } of relaxed) f.current.setLocal(bone, followRotation(f.prev2.local(bone), f.prev.local(bone), rotation, STAND, f.dt, turned));
              },
            }),
            // over it: the right hand on the ball
            chainTo<World>('rightArm', ORIGIN, { ...HAND, on: ball }),
            // over that, for a while: the right hand raised
            function* () {
              yield* action({ until: timePassed(OVERRIDE[0], 'seconds') });
              yield* parallel<Frame<World>>('race', action({ until: timePassed(OVERRIDE[1], 'seconds') }), chainTo<World>('rightArm', { position: RAISED }, HAND));
            },
          );
        },
    };
  },
};
