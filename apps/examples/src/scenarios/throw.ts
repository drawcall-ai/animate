import { Vector3 } from 'three';
import type { Scenario, ScenarioInput } from '../scenario';
import { jointOf } from '../joints';
import { spline, type Key, type V3 } from '../keys';
import { leftOf, minimumJerk, quatYXZ, vec } from '../math';

/** what is thrown at (the middle of a board), straight ahead along +z */
const TARGET = vec(0, 1.5, 14);
const BALL = 0.037;
/** when the weight starts shifting onto the back foot (s) */
const START = 0.8;
/** from the stride foot's lift (s): its contact, the release, the throwing hand let go of */
const CONTACT = 0.5;
const RELEASE = 0.69;
const END = 1.6;
/** how far the facing turns toward the target during the stride (rad) */
const OPEN = 1.0;
/** the ball's speed (m/s) */
const SPEED = 22;
const GRAVITY = 9.81;

/**
 * The ball in the hand from the stride foot's lift (s; x across — + is the side the thrower
 * faces at the set — y up, z toward the target, from where the body stands; m, default body):
 * the set, the arm swinging down, back and up into the cocked position as the stride foot
 * lands, laid back as the trunk turns, the release in front of the head, the follow-through
 * down across the body. Only the ~0.1 s from the cocked arm to the release is fast (a
 * pitch's arm acceleration lasts ~50 ms, Fleisig 1999); the follow-through after it takes
 * its time, decelerating the arm over ~0.4 s.
 */
const ARM: Key<V3>[] = [
  [0, [0.26, 1.12, 0.02]],
  [0.15, [0.18, 0.98, -0.15]],
  [0.3, [0.06, 0.95, -0.45]],
  [0.42, [0.0, 1.3, -0.35]],
  [CONTACT, [-0.03, 1.52, -0.1]],
  [0.6, [0.0, 1.5, 0.02]],
  [RELEASE, [0.08, 1.6, 0.52]],
  [0.8, [0.02, 1.15, 0.75]],
  [1.1, [-0.24, 0.7, 0.65]],
  [END, [-0.25, 0.85, 0.45]],
];
/** the stride foot from where it stood: the knee lifts, then the foot strides toward the target and lands */
const STRIDE: Key<V3>[] = [
  [0, [0, 0, 0]],
  [0.2, [0.04, 0.25, -0.05]],
  [0.36, [0.02, 0.03, 0.25]],
  [CONTACT, [0, 0, 0.5]],
];

/**
 * An overhand throw at a target: the throwing hand's target follows the ball through the
 * throw arc, the stride foot's target lifts the knee and strides toward the target (it is
 * let go of on the floor: the foot stays there), and a walk-to spot square to the target
 * takes over as the foot lands. Balancing on the back leg, the hips turning ahead of the
 * shoulders, the free arm, the follow-through and the back foot coming through are inferred.
 */
export const throwBall: Scenario = {
  id: 'throw',
  title: 'Throwing a ball',
  drives: 'the throwing hand (along the ball’s arc), the stride foot, a walk-to spot square to the target',
  description:
    'An overhand throw from a side-on set: the weight goes onto the back leg, the knee lifts and the foot strides toward the target while the ball swings down, back and up into the cocked position; as the foot lands the body turns square to the target, the ball is released in front of the head and flies off. The weight shift, the hips turning ahead of the shoulders, the free arm, the follow-through and the back foot coming through are inferred.',
  duration: 4,
  actors: [{ yaw: -Math.PI / 2 }],
  facing: 0,
  create() {
    const arm = spline(ARM);
    const stride = spline(STRIDE);
    /** when the stride foot lifted, and where it stood */
    let lift = Infinity;
    let from: Vector3 | null = null;
    /** where the body stands as the stride foot lands, and where it goes once the ball is away */
    let landed: Vector3 | null = null;
    let planted: Vector3 | null = null;
    const ball = new Vector3();
    /** whether the ball is in the hand; once let go of, where and how long it flies (s) */
    let held = true;
    let flight = 0;
    const release = new Vector3();
    const velocity = new Vector3();
    return {
      inputs(t, _dt, [h]) {
        const k = h.proportions.scale;
        if (t >= START && !from) from = h.feet[0].position.clone();
        if (lift === Infinity && h.feet[0].phase !== 'planted') lift = t;
        const s = t - lift;
        const input: ScenarioInput = { lookAt: TARGET };
        const hand = (u: number, out = new Vector3()) => {
          arm(u, out).multiplyScalar(k);
          out.x = -out.x;
          return out;
        };
        if (s < END) input.rightHand = { position: hand(Math.max(0, s)), weight: Math.min(1, t / 0.5) };
        if (from && s < CONTACT) input.leftFoot = { position: stride(Math.max(0, s)).multiplyScalar(k).add(from) };
        // side-on, the hips opening toward the target during the stride; square to it between
        // the feet, mostly over the stride foot, as it lands; over the stride foot once the ball
        // is away (the back foot comes through)
        if (s >= CONTACT && !landed) landed = h.feet[1].position.clone().lerp(h.feet[0].position, 0.6).setY(0);
        if (s >= RELEASE && !planted) planted = h.feet[0].position.clone().setY(0).addScaledVector(leftOf(0), -h.proportions.height * 0.065);
        const open = OPEN * minimumJerk((s - 0.1) / (CONTACT - 0.1));
        const spot = planted ?? landed;
        input.goal = spot ? { position: spot, quaternion: quatYXZ(0) } : { position: vec(0, 0, 0), quaternion: quatYXZ(-Math.PI / 2 + open) };
        // the ball flies on a ballistic arc to the target from where the hand let go of it
        // (where it was drawn: in the solved hand, which may trail its target)
        held = s <= RELEASE;
        if (!held && !flight) {
          jointOf(h, 'rightHand', release);
          flight = release.distanceTo(TARGET) / SPEED;
          velocity.subVectors(TARGET, release).divideScalar(flight);
          velocity.y += 0.5 * GRAVITY * flight;
        }
        if (flight) {
          const e = Math.min(s - RELEASE, flight);
          ball.copy(release).addScaledVector(velocity, e);
          ball.y -= 0.5 * GRAVITY * e * e;
        } else hand(Math.max(0, s), ball);
        return [input];
      },
      props: () => [
        { kind: 'ball', position: ball.clone(), radius: BALL, held: held ? { hand: 'right' } : undefined },
        { kind: 'box', position: TARGET, size: vec(0.8, 0.8, 0.04) },
      ],
    };
  },
};
