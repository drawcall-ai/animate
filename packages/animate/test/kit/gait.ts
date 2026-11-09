import { Vector3 } from 'three';
import { parallel } from '@pmndrs/timeline';
import { Body, humanoid, poseOf, walkTo, type Stride } from '../../src/index';
import { PERSON } from '../../skills/animate/references/person';
import { play } from './bodies';

/** how a person walked over the steady stretch of a walk up +Z */
interface Gait {
  /** steps a minute */
  cadence: number;
  /** its feet's touchdowns (s) */
  touchdowns: number[];
  /** the feet's mean lateral spacing at a touchdown (m), and the landing foot's mean turn out from the way it walks (rad) */
  width: number;
  toeOut: number;
  /** the pelvis's vertical and lateral range (m) */
  bob: number;
  sway: number;
}

/** `bodies` walked side by side up +Z at `speed` (m/s), each measured from `from` s to `to` s */
export function walked(bodies: readonly Body[], speed: number, from = 3, to = 15): Gait[] {
  const seen = bodies.map(() => ({ touchdowns: [] as number[], width: 0, toeOut: 0, low: Infinity, high: -Infinity, left: Infinity, right: -Infinity }));
  const swinging = bodies.map(() => [false, false]);
  const story = () => parallel('all', ...bodies.map((body) => walkTo(body, new Vector3(body.position.x, 0, 40), { speed, until: Infinity })));
  play(story, bodies, to, (time) => {
    bodies.forEach((body, i) => {
      const legs = body.feet, pelvis = poseOf(body).position(0), at = seen[i];
      legs.forEach((leg, side) => {
        const was = swinging[i][side];
        swinging[i][side] = !leg.planted;
        if (time < from || !was || !leg.planted) return;
        at.touchdowns.push(time);
        at.width += Math.abs(leg.position.x - legs[1 - side].position.x);
        at.toeOut += Math.abs(leg.yaw);
      });
      if (time < from) return;
      [at.low, at.high, at.left, at.right] = [Math.min(at.low, pelvis.y), Math.max(at.high, pelvis.y), Math.min(at.left, pelvis.x), Math.max(at.right, pelvis.x)];
    });
  });
  return seen.map(({ touchdowns, width, toeOut, low, high, left, right }) => ({
    cadence: 60 * (touchdowns.length - 1) / (touchdowns[touchdowns.length - 1] - touchdowns[0]),
    touchdowns, width: width / touchdowns.length, toeOut: toeOut / touchdowns.length, bob: high - low, sway: right - left,
  }));
}

/**
 * The cadence a person keeps (steps a minute) at `speed` (m/s) on legs `legs` × the default body's: the default body's 1.75 + 0.3 v steps
 * a second, dynamically similar — its pace v / √legs, its cadence that one's / √legs
 */
export const target = (speed: number, legs: number) => 60 * (1.75 + 0.3 * speed / Math.sqrt(legs)) / Math.sqrt(legs);

/** the life seed the people here are made with: their variation cadence is `variationOf(SEED)`'s */
export const SEED = 7;

/** a person `height` m tall (the default person scaled, its legs × height / 1.75), `x` m to the side, striding as `stride` has it */
export function sized(height: number, x = 0, stride?: Stride): Body {
  const k = height / 1.75;
  const skeleton = PERSON.map((bone) => ({ ...bone, position: [bone.position[0] * k, bone.position[1] * k, bone.position[2] * k] as const }));
  return new Body(humanoid(skeleton, { stride }), { dev: true, at: new Vector3(x, 0, 0), life: { seed: SEED } });
}
