import { Quaternion, Vector3 } from 'three';
import type { Goal, Motion } from '../../kernel/goal';
import { limited } from '../../kernel/limits';
import type { BonePose } from '../../kernel/bone-pose';
import { PointFollower, RotationFollower } from '../../kernel/follow';
import { bowAhead, lowering } from '../legs/lowering';
import { LOWER } from '../legs/walk-pose';
import { INDEX } from '../anatomy/bones';
import type { Frame, Behaviour } from '../../kernel/frame';
import { forwardOf, wrapAngle, yawOf } from '../../kernel/math';
import type { LegGoal } from '../../step/leg-goal';
import type { Person } from '../person';

/** a person as a led head sees it: its proportions, how it walks and stands, and what its parts ask of its stance */
type Led = Pick<Person, 'proportions' | 'locomotion' | 'asks' | 'floor'>;

/** how a tracked head moves (m/s², m/s, rad/s², rad/s): a headset's motion is followed as it comes, only a jump braked */
const HEADSET = { accel: 30, speed: 4, turnAccel: 60, turnSpeed: 10 } satisfies Motion;
/** how fast the spine's joints may change their motion (rad/s²): braked only where the solve kinks */
const JOINTS = { accel: 200 };
/** of the head's turn and bend from the pelvis, the share each joint takes first, lumbar to skull (tuned: the trunk 0.3, the neck 0.35 more, the head the rest) */
const SHARE = [0.15, 0.15, 0.35, 0.35];
/** how many times the spine's solve swings the head over and turns it again (tuned: eight bring a low tracked head within the
 * head-position check; four left it short) */
const PASSES = 8;
/** Leading: once the head is turned this far off the body's facing (rad), for this long (s), the body turns after it, until it faces
 * the head to within SQUARED (rad) and has settled: the trunk and neck take what is less (about ±75°) */
const TURN = 1.0;
const WAIT = 0.1;
const SQUARED = 0.15;
/** how far ahead of the centre of mass the eyes are standing upright (m, default body), and the share of a bow's sweep (`bowAhead`) that
 * takes them further ahead, the hips going back the rest: measured 0.58–0.60 bowing 0.84–1.05 rad, standing and let down 0.22–0.34 m
 * (the sweep a rigid trunk would make, which a squat's tucked pelvis falls short of, gave 0.52 standing and 0.41 let down). The bow asked
 * for a sweep is `lowering`'s, through its lever: a standing articulated bow's sweep to within 5% */
const EYES_AHEAD = 0.085;
const BOW_AHEAD = 0.6;
/** how quickly the way where the body stands moves is picked up (1/s) */
const SPOT_RATE = 10;
/** how fast the body walks round and over under a head (m/s, m/s²) */
const UNDER = { speed: 1.0, accel: 1.2 };

/** Follow tracked eye-midpoint position and orientation (default: level, facing with the pelvis). Run `under` before `look`, and both before the hands, which depend on the posed chest. */
export function heading(person: Led, eyes: (f: Frame) => Goal): { under: (f: Frame) => LegGoal; look: Behaviour } {
  const at = new PointFollower();
  const turned = new RotationFollower();
  const joints = SPINE.map(() => new RotationFollower());
  const head = { position: new Vector3(), quaternion: new Quaternion() };
  const under = bringingUnder(person);
  /** the head's goal this sub-step, as the eyes are followed there */
  const follow = (f: Frame) => {
    const goal = eyes(f), proportions = person.proportions;
    const level = goal.quaternion ?? _level.setFromAxisAngle(UP, yawOf(f.current.local(0)));
    // (the eyes and the head's turn where they were, moved on)
    at.follow(f.prev2.point(INDEX.head, proportions.eyes, _a), f.prev.point(INDEX.head, proportions.eyes, _b), goal.position, HEADSET, f.dt, head.position);
    turned.follow(f.prev2.rotation(INDEX.head), f.prev.rotation(INDEX.head), level, { accel: HEADSET.turnAccel, speed: HEADSET.turnSpeed }, f.dt, head.quaternion);
    return goal;
  };
  let followed = NaN;
  return {
    under: (f) => {
      const goal = follow(f);
      followed = f.time;
      // (turned as the eyes are asked to be: the head turning there behind them would swing the spot under them round as fast as a walk
      // sets off)
      return under(f, goal.position, yawOf(goal.quaternion ?? head.quaternion));
    },
    look: (f) => {
      if (followed !== f.time) follow(f);
      const pose = f.current;
      place(pose, person.proportions.eyes, head.position, head.quaternion);
      SPINE.forEach((bone, k) => pose.setLocal(bone, limited(pose.skeleton, bone, joints[k].follow(f.prev2.local(bone), f.prev.local(bone), pose.local(bone), JOINTS, f.dt, _q))));
    },
  };
}

/** Recruit turning beyond TURN and lowering beneath the tracked eyes; feed the moving support point forward to walking. */
function bringingUnder(person: Led): (f: Frame, eyes: Vector3, yaw: number) => LegGoal {
  const go: LegGoal & { velocity: Vector3 } = { to: new Vector3(NaN), velocity: new Vector3(), ...UNDER };
  let face = NaN;
  /** turning after the head; how long it has been turned past TURN (s); the eyes' last height */
  let turning = false, turnedFor = 0, height = NaN;
  return (f, eyes, yaw) => {
    const proportions = person.proportions;
    const facing = person.locomotion.facing;
    const off = Math.abs(wrapAngle(yaw - facing));
    if (Number.isNaN(face)) face = facing;
    if (turning && off < SQUARED && person.locomotion.settled) [turning, face] = [false, facing];
    turnedFor = off > TURN ? turnedFor + f.dt : 0;
    if (turnedFor >= WAIT) turning = true;
    if (turning) face = yaw;
    go.face = face;
    // (as low as the eyes will be once the knees have caught up: `balance` takes a drop up at its own pace, so the pelvis lags one
    // moving at v by about v² / 2a)
    const rising = Number.isNaN(height) ? 0 : (eyes.y - height) / f.dt;
    height = eyes.y;
    // (over the floor under the eyes: the body stands there)
    const drop = proportions.eyeHeight - (eyes.y - person.floor(eyes.x, eyes.z)) - (rising * Math.abs(rising)) / (2 * LOWER.accel);
    const fwd = forwardOf(yaw, _v);
    const com = f.prev.com(_c);
    const { lower, bow } = lowering(proportions, { height: proportions.eyeHeight, ahead: ((eyes.x - com.x) * fwd.x + (eyes.z - com.z) * fwd.z - EYES_AHEAD * proportions.scale) / BOW_AHEAD, drop });
    // (standing where that bow puts the eyes, and how fast that moves: a head going off is stepped after as it goes. Estimated from the
    // eyes asked, not read off the pose: the bow reaches them from wherever the body stands and the head is held on them, so a spot
    // the pose's eyes measure moves with the body by however far its posture misses them, and is edged after for good)
    const spot = _spot.copy(eyes).addScaledVector(fwd, -EYES_AHEAD * proportions.scale - BOW_AHEAD * bowAhead(proportions, lower, bow, 'eyes')).setY(0);
    if (!Number.isNaN(go.to.x)) go.velocity.lerp(_v.subVectors(spot, go.to).divideScalar(f.dt), 1 - Math.exp(-SPOT_RATE * f.dt));
    go.to.copy(spot);
    person.asks.add({ lower, bow });
    return go;
  };
}

const SPINE = [INDEX.spine, INDEX.chest, INDEX.neck, INDEX.head];

/** With `eyes` in the head frame and `at`/`q` in world coordinates, share the target turn over SPINE, then alternate head-position and head-orientation solves within joint limits. */
function place(pose: BonePose, eyes: Vector3, at: Vector3, q: Quaternion) {
  const [spine, chest, neck, head] = SPINE;
  const rel = _rel.copy(pose.rotation(0)).invert().multiply(q);
  SPINE.forEach((bone, k) => pose.setLocal(bone, limited(pose.skeleton, bone, _share.identity().slerp(rel, SHARE[k]))));
  const origin = _origin.copy(eyes).applyQuaternion(q).negate().add(at);
  for (let pass = 0; pass < PASSES; pass++) {
    swing(pose, spine, origin, 0.5);
    swing(pose, chest, origin, 1);
    const from = _rel.copy(pose.rotation(chest)).invert().multiply(q);
    pose.setLocal(neck, limited(pose.skeleton, neck, _share.identity().slerp(from, 0.5)));
    pose.setLocal(head, limited(pose.skeleton, head, _share.copy(pose.rotation(neck)).invert().multiply(q)));
  }
}

/** `bone` turned (in the world, by `share` of the turn) so the head's origin points at `to` from it */
function swing(pose: BonePose, bone: number, to: Vector3, share: number) {
  const base = pose.position(bone);
  const from = _from.subVectors(pose.position(INDEX.head), base);
  const toward = _to.subVectors(to, base);
  if (from.lengthSq() < 1e-12 || toward.lengthSq() < 1e-12) return;
  const turn = _turn.identity().slerp(_swing.setFromUnitVectors(from.normalize(), toward.normalize()), share);
  pose.setLocal(bone, limited(pose.skeleton, bone, _local.copy(pose.rotation(bone)).premultiply(turn).premultiply(_parent.copy(pose.rotation(pose.skeleton.bones[bone].parent)).invert())));
}

const UP = new Vector3(0, 1, 0);
const [_a, _b, _v, _c, _spot, _origin, _from, _to] = Array.from({ length: 8 }, () => new Vector3());
const [_level, _q, _rel, _share, _turn, _swing, _local, _parent] = Array.from({ length: 8 }, () => new Quaternion());
