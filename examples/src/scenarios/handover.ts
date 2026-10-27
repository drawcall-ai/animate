import { Group, Vector3 } from 'three';
import { action, parallel } from '@pmndrs/timeline';
import { lookAt, reach, wait } from '@drawcall/animate';
import type { Scenario } from '../scenario';
import { ball } from '../things';

// The layering of verbs, bare: a hand on a moving ball, and a newer reach over it for a while, each taking the arm on from where it is.

/** the circle the ball traces in front of the chest (the body at the origin facing +Z): centre, radius (m), period (s) */
const CIRCLE = { centre: new Vector3(-0.2, 1.2, 0.35), radius: 0.12, period: 2.5 };
/** where the newer reach raises the hand, from `OVERRIDE.from` for `OVERRIDE.seconds` s */
const RAISED = new Vector3(-0.35, 1.8, 0.15);
const OVERRIDE = { from: 4, seconds: 2 };
/** how long before the hand the eyes go (s): they reach what the hand goes for first (Land & Hayhoe 2001) */
const LEAD = 0.5;

export const handOver: Scenario = {
  id: 'hand-over',
  title: 'Layers: a hand handed over',
  description:
    'The right hand rides a ball going round a circle, the eyes on it; from 4 s to 6 s a newer reach raises the hand instead, the eyes going there first and back first. Each hand-over is continuous: every verb takes the arm on from the motion it has.',
  duration: 10,
  stage: (cast) => {
    const person = cast.person();
    const scene = new Group();
    const circling = ball(scene, 'ball', 0.03, circle(0));
    const raised = ball(scene, 'raised', 0.03, RAISED);
    raised.visible = false;
    let time = 0;
    return {
      scene,
      bodies: [person],
      story: () => parallel('all',
        // the ball goes round its circle
        action({ update: (_, clock) => void circle((time += clock.delta), circling.position) }),
        // the right hand on it, and over that, for a while, raised
        reach(person, { right: () => circling.position }, { until: Infinity }),
        function* () {
          yield* wait(OVERRIDE.from);
          raised.visible = true;
          yield* reach(person, { right: RAISED }, { until: OVERRIDE.seconds });
          raised.visible = false;
        },
        // the eyes go to where the hand is raised a moment before it goes, and back to the ball a moment before it comes down
        function* () {
          yield* lookAt(person, circling, { until: OVERRIDE.from - LEAD });
          yield* lookAt(person, raised, { until: OVERRIDE.seconds });
          yield* lookAt(person, circling, { until: Infinity });
        },
      ),
      // (the hand back on the ball)
      done: () => person.bones.rightHand.getWorldPosition(new Vector3()).distanceTo(circling.position) < 0.02,
    };
  },
};

/** the circle's point `time` s round it */
function circle(time: number, out = new Vector3()): Vector3 {
  const angle = (2 * Math.PI * time) / CIRCLE.period;
  return out.set(0, CIRCLE.radius * Math.cos(angle), CIRCLE.radius * Math.sin(angle)).add(CIRCLE.centre);
}
