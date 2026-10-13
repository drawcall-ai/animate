import { Quaternion, Vector3 } from 'three';
import { action, parallel, type ReusableTimeline } from '@pmndrs/timeline';
import type { Ctx } from '../../core/body';
import { INDEX, type BoneName } from '../bones';
import type { Humanoid } from '../humanoid';
import { clamp, forwardOf, quatYXZ, Spring, wrapAngle } from '../math';
import { yawOf } from '../rig';
import type { Effector } from '../status';
import { intend } from './follow';
import { feetFacing } from './humanoid';
import { footprint } from '../gait/foot';
import { beyond, hullOf } from '../gait/support';
import { walk } from './walk';
import { lowering } from '../procedures/bow';

/** how stiffly the head follows its tracker (Hz): it goes where it is put */
const HEAD_STIFFNESS = 60;
/** how far the head may turn from the pelvis before the pelvis turns after it (rad): the trunk and neck take ~±75° comfortably */
const TWIST = 0.9;
/** how far the head turns from the pelvis at most (rad): the trunk's and neck's twist; a target turned further is met as far as they go */
const HEAD_TURN = 1.3;
/**
 * how far the pelvis turns from its feet standing (rad): the hips rotate ~45°, less the feet's
 * toe-out; short of where the stand would square its feet up (turning further is stepping round)
 */
const OVER_FEET = 0.4;
/** how fast the pelvis turns after the head standing (rad/s) */
const TURN_RATE = 2.5;
/** how far the knees stay bent under a tracked head (× height): soft, never snapping straight under it as it rises */
const SOFT = 0.02;
/** the trunk's and neck's pull toward upright: just enough to keep the turn and bend shared among them */
const UPRIGHT = 0.005;
/** the facing the head turns the body to beats a walk's */
const FACING = 2;
/**
 * The feet step round under the head: once it is turned this far from them (rad: past what the
 * pelvis, trunk and neck take standing; for this long, s), or where the body stands for it is
 * this far off what the feet bear (m, default body) — until they face it (rad) and the body
 * stands there (m)
 */
const STEP = { turn: 1.0, off: 0.05, wait: 0.1 };
const SETTLED = { turn: 0.15, far: 0.1 };
/** how far ahead the spot's motion is foreseen (s), and how quickly its speed is picked up (1/s) */
const ANTICIPATE = 0.4;
const DRIFT_RATE = 6;
/** how quickly the feet speed up walking round under the head (m/s²): a headset is followed briskly */
const WALK_ACCEL = 1.2;
/** how far a step turns the feet at most (rad): turning round on the spot takes a few steps, the body over them all along */
const PIVOT = 0.7;
/** how far inside the feet's footprints the centre of mass is carried (m, default body), and how firmly (Hz) */
const MARGIN = 0.03;
const BALANCE = 4;
/** how quickly where the centre of mass is carried follows where the body stands for the head (1/s): a sway */
const BALANCE_RATE = 6;
/** how far ahead of the centre of mass the eyes are, standing upright (m, default body) */
const EYES_AHEAD = 0.085;

const ORIGIN = new Vector3();
const TRUNK: readonly BoneName[] = ['spine', 'chest', 'neck', 'head'];
const CARRIERS = TRUNK.map((b) => INDEX[b]);
const _q = new Quaternion();
const _part = new Quaternion();
const _rel = new Quaternion();
const _head = new Quaternion();
const _turn = new Quaternion();
const _at = new Vector3();
const _centre = new Vector3();
const _v = new Vector3();
const _f = new Vector3();
const _com = new Vector3();
const _spot = new Vector3();
const _ahead = new Vector3();
const _away = new Vector3();
const ACROSS = new Vector3(1, 0, 1);
const UP = new Vector3(0, 1, 0);

/** what the head asks of the feet: the way it faces, where the body stands for it (its centre of mass, on the floor) */
interface Lead {
  yaw: number;
  spot: Vector3;
  /** how fast it moves (m/s, smoothed) */
  drift: Vector3;
  /** how far the spot lies off where the feet bear the centre of mass, standing, as it will be shortly (m) */
  off: number;
  stepping: boolean;
}

/**
 * Tracking the head (a headset): the eyes put where the target is, turned as it is — the trunk
 * and neck share the turn and the bend; turned beyond them, the pelvis turns after the head;
 * lowered beyond what a lean takes, the knees bend. Turned further than the body takes standing,
 * or off where it can reach, the feet walk round under the head until they face it and the eyes
 * are there.
 */
export function track<W>(h: Humanoid<W>, target: (ctx: Ctx<W>) => Readonly<Effector>): ReusableTimeline<Ctx<W>> {
  return function* () {
    const lead: Lead = { yaw: h.yaw, spot: new Vector3(), drift: new Vector3(), off: 0, stepping: false };
    yield* parallel<Ctx<W>>('all', intend(h, 'head', target), head(h, target, lead), feet(h, lead));
  };
}

/**
 * the head on its target, the trunk and neck carrying it, the knees bent and the trunk bowed for
 * it; standing, the pelvis turned after it and the centre of mass carried where the body stands
 * for it; what it asks of the feet
 */
function head<W>(h: Humanoid<W>, target: (ctx: Ctx<W>) => Readonly<Effector>, lead: Lead): ReusableTimeline<Ctx<W>> {
  const p = h.proportions;
  const eyes = h.rig.points.eyes;
  return function* () {
    // (the pelvis's facing standing, and where the centre of mass is carried: both taken on from
    // where the walk leaves them)
    let yaw = h.yaw;
    const balance = [new Spring(), new Spring()];
    let standing = false;
    let tracked = false;
    yield* action<Ctx<W>>({
      update: (ctx) => {
        const t = target(ctx);
        const com = ctx.body.com;
        if (!standing || lead.stepping) {
          yaw = yawOf(ctx.body.rotations[0]);
          balance[0].reset(com.x);
          balance[1].reset(com.z);
        }
        standing = !lead.stepping;
        if (t.weight <= 0) {
          lead.spot.set(com.x, 0, com.z);
          lead.drift.set(0, 0, 0);
          lead.off = 0;
          tracked = false;
          return;
        }
        const q = _head.copy(t.quaternion ?? ctx.body.rotations[INDEX.head]);
        const headYaw = (lead.yaw = yawOf(q));
        const fwd = forwardOf(headYaw, _f);
        // (turned further from the pelvis than the trunk and neck go, the head is put as far as
        // they go, about its centre: the rest waits for the feet to come round; and no higher than
        // the body stands: a stretch up is the feet's, onto the toes, not the head's to pull)
        const off = wrapAngle(headYaw - yawOf(ctx.body.rotations[0]));
        const beyond = off - clamp(off, -HEAD_TURN, HEAD_TURN);
        const at = _at.copy(t.position);
        if (beyond !== 0) {
          const centre = _centre.copy(_v.subVectors(p.eyes, p.headCenter).applyQuaternion(q)).negate().add(t.position);
          q.premultiply(_turn.setFromAxisAngle(UP, -beyond));
          at.copy(centre).add(_v.subVectors(p.eyes, p.headCenter).applyQuaternion(q));
        }
        at.y = Math.min(at.y, p.eyeHeight - h.status.stance.crouch);
        // the head lowered: the trunk bows (bending at the hips) for its first LEAN down, the knees
        // bend for the rest (smoothly into and out of the squat's ends; lower, the trunk bows
        // further), never quite straight under it (they would snap straight and back); no higher
        // than that leaves it: a stretch up is the feet's, onto the toes, not the head's to pull
        const drop = Math.max(0, p.eyeHeight - h.status.stance.crouch - at.y);
        const { knees, bow, stoop, ahead } = lowering(p, p.eyeHeight - p.hipHeight, drop, SOFT);
        at.y = Math.min(at.y, p.eyeHeight - h.status.stance.crouch - knees - bow);
        h.hints.crouch(ctx.time, knees * t.weight);
        h.hints.stoop(ctx.time, stoop * t.weight);
        // where the body stands for it (its centre of mass): as far behind it as that bow puts it
        const spot = _spot.copy(at).addScaledVector(fwd, -EYES_AHEAD * p.scale - ahead).setY(0);
        // (and how fast it goes: a head going somewhere is stepped after before it is out of reach)
        if (tracked && ctx.dt > 0) lead.drift.lerp(_v.subVectors(spot, lead.spot).divideScalar(ctx.dt), 1 - Math.exp(-DRIFT_RATE * ctx.dt));
        lead.spot.copy(spot);
        tracked = true;
        if (standing) {
          // standing, the pelvis turns after the head once it is turned beyond what the trunk and
          // neck take, as far as it turns over the feet, at its own pace (the stand carries it);
          // the centre of mass is carried toward the spot, as far as the feet bear it (beyond,
          // they step): the body carries the head over its feet, the stand's own shifting of the
          // weight left out
          const feet = feetFacing(h);
          const ahead = wrapAngle(headYaw - yaw);
          const want = feet + clamp(wrapAngle(yaw + ahead - clamp(ahead, -TWIST, TWIST) - feet), -OVER_FEET, OVER_FEET);
          yaw += clamp(wrapAngle(want - yaw), -TURN_RATE * ctx.dt, TURN_RATE * ctx.dt);
          h.hints.facing(ctx.time, yaw, FACING, t.weight);
          lead.off = onFeet(h, _ahead.copy(spot).addScaledVector(lead.drift, ANTICIPATE), MARGIN * p.scale, _com).distanceTo(_ahead);
          const carried = onFeet(h, spot, MARGIN * p.scale, _com);
          // (from where the walk left it, smoothly)
          carried.set(balance[0].step(carried.x, BALANCE_RATE, ctx.dt), 0, balance[1].step(carried.z, BALANCE_RATE, ctx.dt));
          ctx.propose.target({ kind: 'position', point: 'com', value: carried, mask: ACROSS, weight: t.weight, stiffness: BALANCE, owner: 'track' });
        }
        // (the trunk and neck the head is carried on are the tracker's: their relaxed pose yields)
        ctx.propose.target({ kind: 'position', point: eyes, value: at, weight: t.weight, stiffness: HEAD_STIFFNESS, claims: CARRIERS, owner: 'track' });
        if (t.quaternion) ctx.propose.target({ kind: 'orientation', point: { bone: INDEX.head, at: ORIGIN }, value: q, weight: t.weight, stiffness: HEAD_STIFFNESS, owner: 'track' });
        // (the trunk and neck share the turn and bend from the pelvis's facing, none of them into its stop)
        const rel = _rel.copy(quatYXZ(standing ? yaw : yawOf(ctx.body.rotations[0]), 0, 0, _q)).invert().multiply(q);
        const share = _part.identity().slerp(rel, 1 / TRUNK.length);
        for (const bone of TRUNK) ctx.propose.target({ kind: 'local', point: { bone: INDEX[bone], at: ORIGIN }, value: share, weight: UPRIGHT * t.weight, owner: 'track' });
      },
    });
  };
}

/** `at` (on the floor) brought inside the planted feet's footprints by `margin` (m), into `out` */
function onFeet<W>(h: Humanoid<W>, at: Readonly<Vector3>, margin: number, out: Vector3): Vector3 {
  const hull = hullOf(h.status.feet.flatMap((f) => footprint(h.proportions, f.position, f.yaw)));
  out.set(at.x, 0, at.z);
  const by = beyond(hull, out, _away) + margin;
  return by > 0 ? out.addScaledVector(_away, -by) : out;
}

/**
 * The feet under the head: standing (the stand's), until the head is turned further than the
 * body takes standing or its target is off where the body stands; then walking round under it,
 * facing as it does, until they face it and the body stands there.
 */
function feet<W>(h: Humanoid<W>, lead: Lead): ReusableTimeline<Ctx<W>> {
  const scale = h.proportions.scale;
  const planted = () => h.status.feet.every((f) => f.phase === 'planted');
  const turn = () => Math.abs(wrapAngle(lead.yaw - feetFacing(h)));
  const far = (ctx: Ctx<W>) => Math.hypot(lead.spot.x - ctx.body.com.x, lead.spot.z - ctx.body.com.z);
  return function* () {
    for (;;) {
      // (from standing on both feet: a step the stand takes lands first)
      let asked = 0;
      yield* action<Ctx<W>>({
        update: (ctx) => void (asked = planted() && (turn() > STEP.turn || lead.off > STEP.off * scale) ? asked + ctx.dt : 0),
        until: () => asked >= STEP.wait,
      });
      lead.stepping = true;
      // (left as soon as the feet stand under the head: coming to rest, the walk's posture would
      // hold the body off a head already bending down)
      const facing = () => feetFacing(h) + clamp(wrapAngle(lead.yaw - feetFacing(h)), -PIVOT, PIVOT);
      yield* parallel<Ctx<W>>(
        'race',
        walk(h, { to: () => lead.spot, facing, eager: true, strafe: true, accel: WALK_ACCEL }),
        action<Ctx<W>>({ until: (ctx) => planted() && turn() < SETTLED.turn && far(ctx) < SETTLED.far * scale }),
      );
      lead.stepping = false;
    }
  };
}
