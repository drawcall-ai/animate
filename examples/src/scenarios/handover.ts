import { Vector3 } from 'three';
import { action, parallel, timePassed } from '@pmndrs/timeline';
import { Carrier, createWorld, handTo, idle, type Frame, type Humanoid, type World } from '@drawcall/animate';
import type { Prop, Scenario } from '../scenario';
import { Report, reported } from '../report';

// The layering of behaviours, bare: the base, a hand on a moving ball over it, and an override over
// that for a while, each taking the bones on from where they are.

/** the circle the ball traces in front of the chest (world, the body at the origin facing +Z): centre, radius (m), period (s) */
const CIRCLE = { centre: new Vector3(-0.2, 1.2, 0.35), radius: 0.12, period: 2.5 };
/** where the override raises the hand, from `OVERRIDE[0]` for `OVERRIDE[1]` s */
const RAISED = new Vector3(-0.35, 1.8, 0.15);
const OVERRIDE = [4, 2] as const;
const ON_BALL = { position: new Vector3() };

/** the circle's point at `t` */
const circle = (t: number, at = new Vector3()) => {
  const w = (2 * Math.PI) / CIRCLE.period;
  return at.set(0, CIRCLE.radius * Math.cos(w * t), CIRCLE.radius * Math.sin(w * t)).add(CIRCLE.centre);
};

export const handOver: Scenario = {
  id: 'hand-over',
  title: 'Layers: a hand handed over',
  description:
    'The base stands the body and hangs the arms; over it the right hand rides a ball going round a circle; from 4 s to 6 s a later layer raises the hand instead. Each hand-over is continuous: every layer takes the bones on from the motion they have.',
  duration: 10,
  actors: [{}],
  stage: () => {
    // (the ball: a carrier the stage moves before the body steps; the hand rides it)
    const ball = new Carrier(circle(0));
    const at = new Vector3();
    const report = new Report();
    let body: Humanoid<World> | null = null;
    return {
      world: createWorld(),
      report,
      move: (t) => ball.move(t, circle(t, at)),
      // (the hand back on the ball)
      done: () => !!body && body.pose.position(body.rig.skeleton.index('rightHand')).distanceTo(ball.current.position) < 0.02,
      props: (t) => {
        const targets: Prop[] = [{ kind: 'ball', position: ball.current.position.clone(), radius: 0.03 }];
        if (t >= OVERRIDE[0] && t < OVERRIDE[0] + OVERRIDE[1]) targets.push({ kind: 'ball', position: RAISED.clone(), radius: 0.03 });
        return targets;
      },
      script: (h) =>
        function* () {
          body = h;
          yield* parallel<Frame<World>>(
            'all',
            idle(h),
            // over it: the right hand on the ball
            handTo(h, 'right', reported(report, 'rightHand', ON_BALL), { on: ball }),
            // over that, for a while: the right hand raised
            function* () {
              yield* action({ until: timePassed(OVERRIDE[0], 'seconds') });
              yield* parallel<Frame<World>>('race', action({ until: timePassed(OVERRIDE[1], 'seconds') }), handTo(h, 'right', reported(report, 'rightHand', { position: RAISED })));
            },
          );
        },
    };
  },
};
