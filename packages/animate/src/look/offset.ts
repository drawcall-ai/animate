import { Euler, Quaternion, Vector3 } from 'three';
import type { Frame } from '../kernel/frame';
import { follow } from '../kernel/follow';
import { limited } from '../kernel/limits';
import type { ReadonlyPose } from '../kernel/pose';
import type { Posture } from '../kernel/poise';
import type { Gazer } from '../species/define';

/** A head's turn as `Posture.head` has it: pitch (+ chin down), yaw (+ to its left), roll (+ its left side up), each given (rad). */
type Angles = Required<NonNullable<Posture['head']>>;

/**
 * A head turned on its neck over where its eyes look — a nod, a tilt, a chin thrown back — as additive layers turn it in a game engine:
 * what the story asks each sub-step (`add`, summed: a pose's and a look's) is followed at a head's pace (`NOD`), eased in and back out,
 * and written over the gaze's head (`write`), shared evenly over the neck chain within its joints (or, without one, on the bone that
 * carries the eyes). The gaze aims and follows the head as it would have it (`rotation`, `eyes`): it never chases the offset it is under.
 */
export class HeadOffset {
  private readonly asked: Angles = { pitch: 0, yaw: 0, roll: 0 };
  /** each angle as followed the sub-step before last and the last (rad) */
  private readonly history = { pitch: [0, 0], yaw: [0, 0], roll: [0, 0] };
  /** for each final pose the offset was written into: the head as the gaze had it, turned (world) and where its eyes were */
  private readonly gazed = new WeakMap<ReadonlyPose, { rotation: Quaternion; eyes: Vector3 }>();
  /** each neck bone's own turn as the offset was last written over it, and what it wrote */
  private readonly kept = new Map<number, { under: Quaternion; written: Quaternion }>();

  constructor(private readonly gazer: Gazer | undefined) {}

  /** `angles` asked this sub-step, on top of what is asked already */
  add(angles: NonNullable<Posture['head']>): void {
    for (const key of ANGLES) this.asked[key] += angles[key] ?? 0;
  }

  /** the offset a sub-step on, toward what was asked (then cleared), written over the head in `f.current` */
  write(f: Frame): void {
    const gazer = this.gazer, pose = f.current;
    if (!gazer) return;
    let still = true;
    for (const key of ANGLES) {
      const [before, last] = this.history[key];
      const next = follow(before, last, this.asked[key], NOD, f.dt);
      this.history[key] = [last, Math.abs(next) < 1e-7 && Math.abs(last) < 1e-7 ? 0 : next];
      this.asked[key] = 0;
      still &&= this.history[key][1] === 0;
    }
    const bones = gazer.neck === undefined ? [gazer.head] : pose.skeleton.chain(gazer.neck), last = bones[bones.length - 1];
    // (a bone nothing turned this sub-step — a creature's neck with no gaze to aim it — is under the offset still: from its own turn)
    for (const bone of bones) {
      const kept = this.kept.get(bone);
      if (kept && pose.local(bone).equals(kept.written)) pose.setLocal(bone, kept.under);
    }
    if (still) {
      this.gazed.delete(pose);
      this.kept.clear();
      return;
    }
    const record = this.gazed.get(pose) ?? { rotation: new Quaternion(), eyes: new Vector3() };
    record.rotation.copy(pose.rotation(last));
    gazer.eyes(pose, record.eyes);
    this.gazed.set(pose, record);
    const { pitch, yaw, roll } = this.history;
    const share = _share.identity().slerp(_turn.setFromEuler(_euler.set(pitch[1], yaw[1], roll[1], 'YXZ')), 1 / bones.length);
    // (each bone's share turned about the head's own axes, carried down the chain to it — `below`, the turn from it to the head — so the
    // shares add up to the head's offset)
    const below = _below.identity();
    for (let k = bones.length - 1; k >= 0; k--) {
      const bone = bones[k], under = _under.copy(pose.local(bone));
      const kept = this.kept.get(bone) ?? { under: new Quaternion(), written: new Quaternion() };
      kept.under.copy(under);
      const turned = _local.copy(under).multiply(_conjugated.copy(below).multiply(share).multiply(_inverse.copy(below).invert()));
      pose.setLocal(bone, limited(pose.skeleton, bone, turned));
      kept.written.copy(pose.local(bone));
      this.kept.set(bone, kept);
      below.premultiply(under);
    }
  }

  /** the turn (world) of the neck's last bone in `pose`, as the gaze had it before the offset */
  rotation(pose: ReadonlyPose, bone: number): Readonly<Quaternion> {
    return this.gazed.get(pose)?.rotation ?? pose.rotation(bone);
  }

  /** where the eyes were in `pose`, as the gaze had the head before the offset, into `out` */
  eyes(pose: ReadonlyPose, out: Vector3): Vector3 {
    const record = this.gazed.get(pose);
    if (record) return out.copy(record.eyes);
    if (!this.gazer) throw new Error('a head offset on a body with no gaze');
    return this.gazer.eyes(pose, out);
  }
}

const ANGLES = ['pitch', 'yaw', 'roll'] as const satisfies readonly (keyof Angles)[];
/**
 * How briskly a head's offset is taken up and given back (rad/s², rad/s): a nod's ~15° down in about a quarter of a second, a head thrown
 * back half a radian in under half a second (tuned; a voluntary nod's peak ~100–150°/s, recalled, not checked)
 */
const NOD = { accel: 14, speed: 2.5 };
const _euler = new Euler(), _turn = new Quaternion(), _share = new Quaternion(), _local = new Quaternion();
const _below = new Quaternion(), _under = new Quaternion(), _conjugated = new Quaternion(), _inverse = new Quaternion();
