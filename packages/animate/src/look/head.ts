import { Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import type { Motion, Placement } from '../kernel/goal';
import { clampRotation } from '../kernel/limits';
import type { Pose } from '../kernel/pose';
import { TrackedPoint, TrackedRotation } from '../kernel/track';
import { lowering, LOWER } from '../legs/person/posture';
import { INDEX } from '../species/humanoid/bones';
import type { Person } from '../body/person';
import type { Step } from '../body/runtime';
import { forwardOf, wrapAngle, yawOf } from '../kernel/math';
import type { Go } from '../kernel/go';

/** how a tracked head moves (m/s², m/s, rad/s², rad/s): a headset's motion is followed as it comes, only a jump braked */
const HEADSET = { accel: 30, speed: 4, turnAccel: 60, turnSpeed: 10 } satisfies Motion;
/** how fast the spine's joints may change their motion (rad/s²): braked only where the solve kinks */
const JOINTS = { accel: 200 };
/** of the head's turn and bend from the pelvis, the share each joint takes first, lumbar to skull (tuned: the trunk 0.3, the neck 0.35 more, the head the rest) */
const SHARE = [0.15, 0.15, 0.35, 0.35];
/** Tuned: eight passes converge low tracked targets within the head-position gate; four left a residual.
 * The spine's solve: how many times the trunk swings the head over and the neck turns it again */
const PASSES = 8;
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
/** how quickly the way where the body stands moves is picked up (1/s) */
const SPOT_RATE = 10;
/** how fast the body walks round and over under a head (m/s, m/s²) */
const UNDER = { speed: 1.0, accel: 1.2 };

/**
 * The eyes (their midpoint) at `eyes`, the head turned as it says (default: level, facing as the pelvis does), a sub-step at a time
 * (`look`): the target moved on from where it was (a headset's pace, its own motion fed forward), and the spine, lumbar to skull, placed
 * for it — the turn and bend shared over the lower back, the thorax, the neck and the head first, then the trunk swinging the head over
 * where the eyes go and the neck turning it again, each joint within its range and braked. It writes the spine, chest, neck and head, so
 * runs before the hands (they hang off the chest it places). With `under` run before it, the body comes along: it turns round under a head
 * turned further than the trunk and neck take, stands where the eyes are over it, bows and squats for a head lower than standing and goes
 * up on its toes for one higher.
 */
export function heading(h: Person, eyes: (f: Frame) => Placement, pace: Motion = HEADSET): { under: (f: Frame) => Go; look: Step } {
  const at = new TrackedPoint();
  const turned = new TrackedRotation();
  const joints = SPINE.map(() => new TrackedRotation());
  const head = { position: new Vector3(), quaternion: new Quaternion() };
  const under = new Under(h);
  /** the head's goal this sub-step, as the eyes are followed there */
  const follow = (f: Frame) => {
    const goal = eyes(f), p = h.proportions;
    const level = goal.quaternion ?? _level.setFromAxisAngle(UP, yawOf(f.current.local(0)));
    // (the eyes and the head's turn where they were, moved on)
    at.follow(f.prev2.point(INDEX.head, p.eyes, _a), f.prev.point(INDEX.head, p.eyes, _b), goal.position, pace, f.dt, head.position);
    turned.follow(f.prev2.rotation(INDEX.head), f.prev.rotation(INDEX.head), level, { accel: pace.turnAccel ?? HEADSET.turnAccel, speed: pace.turnSpeed }, f.dt, head.quaternion);
    return goal;
  };
  let followed = NaN;
  return {
    under: (f) => {
      const goal = follow(f);
      followed = f.time;
      return under.ask(f, goal.position, yawOf(head.quaternion));
    },
    look: (f) => {
      if (followed !== f.time) follow(f);
      const pose = f.current;
      place(pose, h.proportions.eyes, head.position, head.quaternion);
      SPINE.forEach((bone, k) => {
        const q = joints[k].follow(f.prev2.local(bone), f.prev.local(bone), pose.local(bone), JOINTS, f.dt, _q);
        const limit = pose.skeleton.limits[bone];
        if (limit) clampRotation(q, limit);
        pose.setLocal(bone, q);
      });
    },
  };
}

/**
 * The body brought under a led head, every sub-step: turned round after the head once it
 * is turned further than the trunk and neck take (TURN), and held facing as it was otherwise;
 * bowed and let down as far as the eyes go ahead and down (`stoop`); standing where that puts the
 * eyes, walking there (its way fed forward) once it is far enough to.
 */
class Under {
  private readonly face = { yaw: NaN };
  private readonly go: Go & { velocity: Vector3 } = { to: new Vector3(NaN), velocity: new Vector3(), ...UNDER, face: this.face };
  /** turning after the head; how long it has been turned past TURN (s); the eyes' last height */
  private turning = false;
  private off = 0;
  private height = NaN;

  constructor(private readonly h: Person) {}

  /** the body bowed and let down for the eyes at `eyes`, the head facing `yaw`, and where its legs go under them */
  ask(f: Frame, eyes: Vector3, yaw: number): Go {
    const { h, go, face } = this;
    const p = h.proportions;
    const facing = h.locomotion.facing;
    const off = Math.abs(wrapAngle(yaw - facing));
    if (Number.isNaN(face.yaw)) face.yaw = facing;
    if (this.turning && off < SQUARED && h.locomotion.settled) [this.turning, face.yaw] = [false, facing];
    this.off = off > TURN ? this.off + f.dt : 0;
    if (this.off >= WAIT) this.turning = true;
    if (this.turning) face.yaw = yaw;
    // (as low as the eyes will be once the knees have caught up: `balance` takes a drop up at its
    // own pace, so the pelvis lags one moving at v by about v² / 2a)
    const rising = Number.isNaN(this.height) ? 0 : (eyes.y - this.height) / f.dt;
    this.height = eyes.y;
    const drop = p.eyeHeight - eyes.y - (rising * Math.abs(rising)) / (2 * LOWER.accel);
    const fwd = forwardOf(yaw, _v);
    const com = f.prev.com(_c);
    const { lower, bow } = lowering(p, { height: p.eyeHeight, ahead: ((eyes.x - com.x) * fwd.x + (eyes.z - com.z) * fwd.z - EYES_AHEAD * p.scale) / BOW_AHEAD, drop });
    // (standing where that bow puts the eyes: where it stands now, unless they are further ahead or
    // behind than it takes them; and how fast that moves: a head going off is stepped after as it goes)
    // The planner follows the carried posture's actual eye offset; the retiring balance keeps its standing estimate.
    const spot = h.stepper
      ? _spot.copy(eyes).sub(f.current.point(INDEX.head, p.eyes, _v)).add(f.current.com(_c)).setY(0)
      : _spot.copy(eyes).addScaledVector(fwd, -EYES_AHEAD * p.scale - BOW_AHEAD * (p.eyeHeight - p.hipHeight) * Math.sin(bow)).setY(0);
    if (!Number.isNaN(go.to.x)) go.velocity.lerp(_v.subVectors(spot, go.to).divideScalar(f.dt), 1 - Math.exp(-SPOT_RATE * f.dt));
    go.to.copy(spot);
    h.poise.add({ lower, bow });
    return go;
  }
}

const SPINE = [INDEX.spine, INDEX.chest, INDEX.neck, INDEX.head];

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
