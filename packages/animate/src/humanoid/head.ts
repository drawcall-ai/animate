import { Quaternion, Vector3 } from 'three';
import { action, type UntilCondition } from '@pmndrs/timeline';
import type { Frame } from '../core/body';
import { live, type Behaviour, type Live, type Motion, type Placement } from '../core/goal';
import { clampRotation } from '../core/limits';
import type { Pose } from '../core/pose';
import { TrackedPoint, TrackedRotation } from '../core/track';
import { TIPTOE } from './balance/posture';
import { INDEX } from './bones';
import type { Humanoid } from './humanoid';
import { clamp, forwardOf, wrapAngle } from './math';
import type { Proportions } from './proportions';
import { yawOf } from './rig';

/** how a tracked head moves (m/s², m/s, rad/s², rad/s): a headset's motion is followed as it comes, only a jump braked */
export const HEADSET = { accel: 30, speed: 4, turnAccel: 60, turnSpeed: 10 } satisfies Motion;
/** how fast the spine's joints may change their motion (rad/s²): braked only where the solve kinks */
const JOINTS = { accel: 200 };
/** of the head's turn and bend from the pelvis, the share each joint takes first, lumbar to skull (old core: the trunk 0.3, the neck 0.35 more, the head the rest) */
const SHARE = [0.15, 0.15, 0.35, 0.35];
/** the spine's solve: how many times the trunk swings the head over and the neck turns it again */
const PASSES = 4;
/**
 * Leading: once the head is turned this far off the body's facing (rad), for this long (s), the body
 * turns after it, until it faces the head to within SQUARED (rad) and has settled: the trunk and
 * neck take what is less (about ±75°)
 */
const TURN = 1.0;
const WAIT = 0.1;
const SQUARED = 0.15;
/** how far ahead of the centre of mass the eyes are standing upright (m, default body), and the share of a bow's sweep that takes them further ahead (the hips go back the rest) */
const EYES_AHEAD = 0.085;
const BOW_AHEAD = 0.5;
/** the furthest the trunk bows before the body steps closer (rad), and how far the knees let the pelvis down at most (× height: a squat, as `balance`'s) */
const MOST_BOW = 1.0;
/** how fast `balance` changes the drop asked of the knees (m/s²: its squat's pace) */
const KNEES = 3;
const SQUAT = 0.25;
/** how quickly the way where the body stands moves is picked up (1/s) */
const SPOT_RATE = 10;
/** how fast the body walks round and over under a head (m/s, m/s²) */
const UNDER = { speed: 1.0, accel: 1.2 };

export interface HeadOptions<W> extends Partial<Motion> {
  /** the body follows the head (a headset): it turns round, steps over, bows and squats as the head asks (`h.asks`); otherwise only the spine reaches */
  lead?: boolean;
  until?: UntilCondition<Frame<W>>;
}

/**
 * The eyes (their midpoint) at `eyes`, the head turned as it says (default: level, facing as the
 * pelvis does), every sub-step, endless or until `until`: the target moved on from where it was
 * (`HEADSET` pace by default, its own motion fed forward), and the spine, lumbar to skull, placed
 * for it — the turn and bend shared over the lower back, the thorax, the neck and the head first,
 * then the trunk swinging the head over where the eyes go and the neck turning it again, each joint
 * within its range and braked. It writes the spine, chest, neck and head: put it after `idle` and
 * before the hands (they hang off the chest it places). With `lead`, the body comes along: it
 * turns round under a head turned further than the trunk and neck take, stands where the eyes are
 * over it, bows and squats for a head lower than standing and goes up on its toes for one higher.
 */
export function headTo<W>(h: Humanoid<W>, eyes: Live<Placement, W>, options: HeadOptions<W> = {}): Behaviour<W> {
  const { lead = false, until } = options;
  const pace = { ...HEADSET, ...options };
  return function* () {
    const at = new TrackedPoint();
    const turned = new TrackedRotation();
    const joints = SPINE.map(() => new TrackedRotation());
    const head = { position: new Vector3(), quaternion: new Quaternion() };
    const body = { facing: NaN, off: 0, turning: false, height: NaN, spot: new Vector3(NaN, 0, 0), velocity: new Vector3() };
    yield* action<Frame<W>>({
      update: (f) => {
        const goal = live(eyes, f);
        const p = h.proportions;
        const pose = f.current;
        const level = goal.quaternion ?? _level.setFromAxisAngle(UP, yawOf(pose.local(0)));
        // (the eyes and the head's turn where they were, moved on)
        at.follow(f.prev2.point(INDEX.head, p.eyes, _a), f.prev.point(INDEX.head, p.eyes, _b), goal.position, pace, f.dt, head.position);
        turned.follow(f.prev2.rotation(INDEX.head), f.prev.rotation(INDEX.head), level, { accel: pace.turnAccel, speed: pace.turnSpeed }, f.dt, head.quaternion);
        place(pose, p.eyes, head.position, head.quaternion);
        SPINE.forEach((bone, k) => {
          const q = joints[k].follow(f.prev2.local(bone), f.prev.local(bone), pose.local(bone), JOINTS, f.dt, _q);
          const limit = pose.skeleton.limits[bone];
          if (limit) clampRotation(q, limit);
          pose.setLocal(bone, q);
        });
        if (!lead) return;

        // the body under the head: turned round after it, standing where the eyes are over it, as low as they are
        const yaw = yawOf(head.quaternion);
        if (Number.isNaN(body.facing)) body.facing = h.gait.facing;
        const off = Math.abs(wrapAngle(yaw - h.gait.facing));
        if (body.turning && off < SQUARED && h.gait.settled) {
          body.turning = false;
          body.facing = h.gait.facing;
        }
        body.off = off > TURN ? body.off + f.dt : 0;
        if (body.off >= WAIT) body.turning = true;
        if (body.turning) body.facing = yaw;
        // (as low as the eyes will be once the knees have caught up: `balance` takes a drop up at its
        // own pace, so the pelvis lags one moving at v by about v² / 2a)
        const rising = Number.isNaN(body.height) ? 0 : (goal.position.y - body.height) / f.dt;
        body.height = goal.position.y;
        const drop = p.eyeHeight - goal.position.y - (rising * Math.abs(rising)) / (2 * KNEES);
        const fwd = forwardOf(yaw, _v);
        const com = f.prev.com(_c);
        const ahead = (goal.position.x - com.x) * fwd.x + (goal.position.z - com.z) * fwd.z;
        const { lower, bow } = stoop(p, ahead, drop);
        const asks = h.asks;
        asks.lower = lower;
        asks.bow = bow;
        // (standing where that bow puts the eyes: where it stands now, unless they are further ahead or behind than it takes them)
        const spot = _spot.copy(goal.position).addScaledVector(fwd, -EYES_AHEAD * p.scale - BOW_AHEAD * (p.eyeHeight - p.hipHeight) * Math.sin(bow)).setY(0);
        // (and how fast it moves: a head going off is stepped after as it goes)
        if (!Number.isNaN(body.spot.x)) body.velocity.lerp(_v.subVectors(spot, body.spot).divideScalar(f.dt), 1 - Math.exp(-SPOT_RATE * f.dt));
        body.spot.copy(spot);
        asks.go = { to: spot, velocity: body.velocity, ...UNDER };
        asks.face = { yaw: body.facing };
      },
      until,
    });
  };
}

const SPINE = [INDEX.spine, INDEX.chest, INDEX.neck, INDEX.head];

/**
 * how a standing body brings its eyes `ahead` of its centre of mass (m) and `drop` below standing
 * (m): bowed (rad) as far as takes them that far ahead (the hips going back the rest), no further than
 * lets them down that far on straight knees, nor than MOST_BOW; the knees bent (`lower`, m) for
 * the rest of the drop as far as they bend, bowed further past that; up on the toes for eyes above
 * standing
 */
function stoop(p: Proportions, ahead: number, drop: number): { lower: number; bow: number } {
  const above = p.eyeHeight - p.hipHeight;
  const reach = (ahead - EYES_AHEAD * p.scale) / (BOW_AHEAD * above);
  const bow = Math.min(Math.asin(clamp(reach, 0, 1)), Math.acos(1 - clamp(drop / above, 0, 1)), MOST_BOW);
  const lower = drop - above * (1 - Math.cos(bow));
  if (lower < 0) return { lower: Math.max(lower, -TIPTOE * p.scale), bow };
  if (lower <= SQUAT * p.height) return { lower, bow };
  return { lower: SQUAT * p.height, bow: Math.acos(1 - clamp((drop - SQUAT * p.height) / above, 0, 1)) };
}

/**
 * the spine (lumbar to skull) placed in `pose` so the eyes (`eyes`, in the head's frame) are at
 * `at`, the head turned `q` (world), as near as its joints' ranges allow: the turn and bend from the
 * pelvis shared over its joints (SHARE); then, PASSES times, the lower back and the thorax swing
 * the head's origin over where it goes (half and the rest) and the neck and head turn it to `q` again
 */
function place(pose: Pose, eyes: Vector3, at: Vector3, q: Quaternion) {
  const [spine, chest, neck, head] = SPINE;
  const rel = _rel.copy(pose.rotation(0)).invert().multiply(q);
  SPINE.forEach((bone, k) => limited(pose, bone, _share.identity().slerp(rel, SHARE[k])));
  const origin = _origin.copy(eyes).applyQuaternion(q).negate().add(at);
  for (let pass = 0; pass < PASSES; pass++) {
    swing(pose, spine, origin, 0.5);
    swing(pose, chest, origin, 1);
    const from = _rel.copy(pose.rotation(chest)).invert().multiply(q);
    limited(pose, neck, _share.identity().slerp(from, 0.5));
    limited(pose, head, _share.copy(pose.rotation(neck)).invert().multiply(q));
  }
}

/** `bone` turned (in the world, by `share` of the turn) so the head's origin points at `to` from it */
function swing(pose: Pose, bone: number, to: Vector3, share: number) {
  const base = pose.position(bone);
  const from = _from.subVectors(pose.position(INDEX.head), base);
  const toward = _to.subVectors(to, base);
  if (from.lengthSq() < 1e-12 || toward.lengthSq() < 1e-12) return;
  const turn = _turn.identity().slerp(_swing.setFromUnitVectors(from.normalize(), toward.normalize()), share);
  limited(pose, bone, _local.copy(pose.rotation(bone)).premultiply(turn).premultiply(_parent.copy(pose.rotation(pose.skeleton.bones[bone].parent)).invert()));
}

/** `bone`'s rotation in its parent's frame set to `q`, within its range */
function limited(pose: Pose, bone: number, q: Quaternion) {
  const limit = pose.skeleton.limits[bone];
  if (limit) clampRotation(q, limit);
  pose.setLocal(bone, q);
}

const UP = new Vector3(0, 1, 0);
const _level = new Quaternion();
const _q = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _v = new Vector3();
const _c = new Vector3();
const _spot = new Vector3();
const _rel = new Quaternion();
const _share = new Quaternion();
const _origin = new Vector3();
const _from = new Vector3();
const _to = new Vector3();
const _turn = new Quaternion();
const _swing = new Quaternion();
const _local = new Quaternion();
const _parent = new Quaternion();
