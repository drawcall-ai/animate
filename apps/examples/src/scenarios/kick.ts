import { Vector3 } from 'three';
import type { Scenario, ScenarioInput } from '../scenario';
import { spline, type Key, type V3 } from '../keys';
import { forwardOf, leftOf, minimumJerk, quatYXZ, vec } from '../math';

const RADIUS = 0.11;
/** the ball, and the goal it is kicked at (along +z) */
const BALL = vec(0, RADIUS, 3.2);
const AIM = vec(0, 1.2, 18);
/** the walk-up: from where (m, at about 30° to the kick) */
const FROM = vec(-1.4, 0, 0.6);
/** the support foot's plant beside the ball: across (to the left of the ball) and behind it (m, default body) */
const PLANT = { across: 0.16, behind: 0.06 };
/** the walk-up's stance as it comes to the ball: the support foot ahead of the kicking one (m) */
const STANCE = { width: 0.115, stagger: 0.25 };
/** the kick starts once the body is this close to its stand (m, default body) */
const ARRIVED = 0.35;
/** the walk-up squares to the kick this close to the stand (m, default body) */
const SQUARE = 0.8;
/** from the kicking foot's lift (s): contact, the foot let go of on the floor */
const CONTACT = 0.33;
const END = 0.73;
const GRAVITY = 9.81;

/**
 * The kicking foot from the ball (x left, y up, z along the kick; m, default body) from its
 * lift: drawn back with the knee flexed (the heel toward the buttock), swung through the
 * ball's middle with the knee snapping straight, following through high, then coming back
 * down, the knee bending, and set down beside the ball — within the leg's reach of where the
 * body stands (a target let go of out of reach would pull the body down into a lunge).
 * Kicking-foot toe-off to impact takes ~0.3 s, impact to the top of the follow-through
 * ~0.12 s (instep kicks: Lees & Nolan 1998; Kellis & Katis 2007).
 */
const SWING: Key<V3>[] = [
  [0.2, [-0.18, 0.66, -0.8]],
  [CONTACT, [-0.03, 0.2, -0.12]],
  [0.45, [0.0, 0.5, 0.45]],
  [0.59, [-0.04, 0.3, 0.2]],
  [END, [-0.1, 0.07, 0.08]],
]

type Phase =
  | { name: 'run' }
  | { name: 'kick'; lift: number | null; from: Vector3 | null }
  | { name: 'after'; spot: Vector3 | null };

/**
 * Kicking a ball: a walk-to spot beside the ball brings the body in at an angle, squaring up
 * over the last stride, which plants the support foot beside the ball; the kicking foot's
 * target draws back, swings through the ball and is set down ahead (let go of on the floor,
 * it stays there). The plant, the weight onto the support leg, the arms out for balance, the
 * lean and the follow-through step are inferred.
 */
export const kickBall: Scenario = {
  id: 'kick-ball',
  title: 'Kicking a ball',
  drives: 'a walk-to spot beside the ball (the run-up), the kicking foot',
  description:
    'A brisk run-up at an angle to the ball, whose last stride plants the support foot beside it; the kicking leg draws back with the knee flexed and swings through the ball, the knee snapping straight, the ball flies off and the foot is set down ahead. The plant, the weight onto the support leg, the arms out for balance, the lean and the step through are inferred.',
  duration: 5,
  actors: [{ position: { x: FROM.x, y: 0, z: FROM.z }, yaw: Math.atan2(BALL.x - FROM.x, BALL.z - FROM.z), maxSpeed: 1.7, accel: 1.8, stance: STANCE }],
  facing: 0,
  create() {
    let phase: Phase = { name: 'run' };
    const swing = spline(SWING);
    const ball = BALL.clone();
    let struck: number | null = null;
    const velocity = new Vector3();
    return {
      inputs(t, _dt, [h]) {
        const k = h.proportions.scale;
        // (where the body stands as the support foot is down beside the ball)
        const stand = vec(BALL.x + (PLANT.across - STANCE.width) * k, 0, BALL.z - (PLANT.behind + STANCE.stagger / 2) * k);
        const input: ScenarioInput = { lookAt: ball.clone() };
        if (phase.name === 'run') {
          // the walk-up: square to the kick, the support foot coming down beside the ball
          // (facing the way it walks, squaring up over the last stride)
          const r = h.model.scene.position;
          const near = Math.hypot(stand.x - r.x, stand.z - r.z) < SQUARE * k;
          input.goal = t > 0.4 ? { position: stand.clone(), quaternion: near ? quatYXZ(0) : undefined } : undefined;
          if (Math.hypot(stand.x - r.x, stand.z - r.z) < ARRIVED * k) phase = { name: 'kick', lift: null, from: null };
        }
        if (phase.name === 'kick') {
          const right = h.feet[1];
          phase.from ??= right.position.clone();
          if (phase.lift === null && right.phase === 'lifted') phase.lift = t;
          const s = phase.lift === null ? 0 : t - phase.lift;
          // from where the foot stood up into the backswing (easing in and out), then along the swing
          const pos = s < SWING[0][0] ? phase.from.clone().lerp(at(swing(SWING[0][0]), k), minimumJerk(s / SWING[0][0])) : at(swing(s), k);
          input.rightFoot = { position: pos };
          if (s >= CONTACT && struck === null) struck = t;
          if (s >= END) phase = { name: 'after', spot: null };
        }
        // landing on the kicking foot, the support foot comes through beside it
        if (phase.name === 'after') {
          // (from where the kicking foot was set down — its foothold is not there yet as it is let
          // go of; the stance's stagger keeps the support foot ahead: it steps through past it)
          phase.spot ??= at(swing(END), k).setY(0).addScaledVector(leftOf(0), STANCE.width * k).addScaledVector(forwardOf(0), (STANCE.stagger / 2) * k);
          input.goal = { position: phase.spot, quaternion: quatYXZ(0) };
        }
        // the ball flies off on a ballistic arc
        if (struck !== null) {
          const time = BALL.distanceTo(AIM) / 22;
          velocity.subVectors(AIM, BALL).divideScalar(time);
          velocity.y += 0.5 * GRAVITY * time;
          const e = Math.min(t - struck, time);
          ball.copy(BALL).addScaledVector(velocity, e);
          ball.y -= 0.5 * GRAVITY * e * e;
        }
        return [input];
      },
      props: () => [{ kind: 'ball', position: ball.clone(), radius: RADIUS }],
    };
  },
};

/** a point given from the ball (x left, y up, z along the kick; scaled to the body) in the world */
const at = (p: Vector3, k: number) => vec(BALL.x + p.x * k, p.y * k, BALL.z + p.z * k);
