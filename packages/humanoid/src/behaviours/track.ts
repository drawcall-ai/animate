import { Quaternion, Vector3 } from 'three';
import { action, parallel, type ReusableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '@prohuman/body';
import { INDEX, type BoneName } from '../bones';
import type { Humanoid } from '../humanoid';
import { clamp, quatYXZ, Spring, wrapAngle } from '../math';
import { yawOf } from '../rig';
import type { Effector } from '../status';
import { intend } from './follow';
import { feetFacing } from './humanoid';

/** how stiffly the head follows its tracker (Hz): it goes where it is put */
const HEAD_STIFFNESS = 60;
/** how far the head may turn from the pelvis before the pelvis turns after it (rad): the trunk and neck take ~±75° comfortably */
const TWIST = 0.9;
/** how far the head turns from the pelvis at most (rad): the trunk's and neck's twist; a target turned further is met as far as they go */
const HEAD_TURN = 1.3;
/** how far the pelvis may turn from its feet before it waits for them to step round (rad): the hips rotate ~45°, less the feet's toe-out, and a margin for the standing hip as the other steps */
const OVER_FEET = 0.5;
/** how fast the pelvis turns after the head (rad/s) */
const TURN_RATE = 2.5;
/** how far the trunk leans to bring the head down before the knees bend (m, × height) */
const LEAN = 0.08;
/** how deep the knees bend at most for the head (× height): a squat the body balances in, heels down; lower, the trunk bends further */
const SQUAT = 0.25;
/** the trunk's and neck's pull toward upright: just enough to keep the turn and bend shared among them */
const UPRIGHT = 0.03;
/** the facing the head turns the body to beats a walk's */
const FACING = 2;

const ORIGIN = new Vector3();
const TRUNK: readonly BoneName[] = ['spine', 'chest', 'neck', 'head'];
const _q = new Quaternion();
const _part = new Quaternion();
const _rel = new Quaternion();
const _head = new Quaternion();
const _turn = new Quaternion();
const _at = new Vector3();
const _centre = new Vector3();
const _v = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * Tracking the head (a headset): the eyes put where the target is, turned as it is — the trunk
 * and neck share the turn and the bend; turned beyond them, the pelvis turns after the head (and
 * the stance's steps after the pelvis); lowered beyond what a lean takes, the knees bend.
 */
export function track<W>(h: Humanoid<W>, target: (ctx: Ctx<W>) => Readonly<Effector>): ReusableTimeline<Ctx<W>> {
  const p = h.proportions;
  const eyes = h.rig.points.eyes;
  return function* () {
    const yaw = new Spring(h.yaw);
    const drop = new Spring();
    yield* parallel<Ctx<W>>(
      'all',
      intend(h, 'head', target),
      action<Ctx<W>>({
        update: (ctx) => {
          const t = target(ctx);
          if (t.weight <= 0) return;
          const weight = t.weight;
          const q = _head.copy(t.quaternion ?? ctx.body.rotations[INDEX.head]);
          const headYaw = yawOf(q);
          // (turned further from the pelvis than the trunk and neck go, the head is put as far as
          // they go, about its centre: the rest waits for the pelvis and the feet to come round)
          const pelvisYaw = yawOf(ctx.body.rotations[0]);
          const off = wrapAngle(headYaw - pelvisYaw);
          const beyond = off - clamp(off, -HEAD_TURN, HEAD_TURN);
          const at = _at.copy(t.position);
          if (beyond !== 0) {
            const centre = _centre.copy(_v.subVectors(p.eyes, p.headCenter).applyQuaternion(q)).negate().add(t.position);
            q.premultiply(_turn.setFromAxisAngle(UP, -beyond));
            at.copy(centre).add(_v.subVectors(p.eyes, p.headCenter).applyQuaternion(q));
          }
          // (and no higher than the body stands: a stretch up is the feet's, onto the toes, not the head's to pull)
          at.y = Math.min(at.y, p.eyeHeight - h.status.stance.crouch);
          ctx.propose.target({ kind: 'position', point: eyes, value: at, weight, stiffness: HEAD_STIFFNESS, owner: 'track' });
          if (t.quaternion) ctx.propose.target({ kind: 'orientation', point: { bone: INDEX.head, at: ORIGIN }, value: q, weight, stiffness: HEAD_STIFFNESS, owner: 'track' });
          // the pelvis turns after the head once it is turned beyond what the trunk and neck take
          // (and only so far from the feet: further, it waits for them to step round; it turns at
          // its own pace either way, the feet's facing changing as they land)
          const ahead = wrapAngle(headYaw - yaw.value);
          const feet = feetFacing(h);
          const want = feet + clamp(wrapAngle(yaw.value + ahead - clamp(ahead, -TWIST, TWIST) - feet), -OVER_FEET, OVER_FEET);
          yaw.value += clamp(wrapAngle(want - yaw.value), -TURN_RATE * ctx.dt, TURN_RATE * ctx.dt);
          // the head lowered: first the trunk leans, then the knees bend
          const below = Math.max(0, p.eyeHeight - t.position.y);
          const knees = clamp(below - LEAN * p.height, 0, SQUAT * p.height);
          // (the stand carries the pelvis, over the feet: it is asked to turn and crouch)
          h.hints.crouch(ctx.time, drop.step(knees, 6, ctx.dt) * t.weight);
          h.hints.facing(ctx.time, yaw.value, FACING, t.weight);
          quatYXZ(yaw.value, 0, 0, _q);
          // (the trunk and neck share the turn and bend, none of them into its stop)
          const rel = _rel.copy(_q).invert().multiply(q);
          const share = _part.identity().slerp(rel, 1 / TRUNK.length);
          for (const bone of TRUNK) ctx.propose.target({ kind: 'local', point: { bone: INDEX[bone], at: ORIGIN }, value: share, weight: UPRIGHT * t.weight, owner: 'track' });
        },
      }),
    );
  };
}
