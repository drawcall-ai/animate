import type { LegGoal } from '../step/leg-goal';
import type { HandShape } from '../fingers/shape';
import type { Vector3 } from 'three';

/**
 * A posture authored over whatever the body is doing (`pose`), as an additive layer or an aim offset is in a game engine: each field is
 * added onto what the body's own tasks ask (a reach's bow, an aim's turn), held in balance, as far as its joints allow. Radians by the
 * right-hand rule about the body's axes (+X its left, +Y up, +Z ahead), metres for `lower`; a field left out is 0.
 */
export interface Posture {
  /** the trunk bowed forward at the hips and back (rad, + forward; − arches it back, the chest lifting) */
  bow?: number;
  /** the chest turned off the hips (rad, + to its left: the right shoulder forward, the left back; − winds a right-handed throw up) */
  twist?: number;
  /** the trunk bent sideways (rad, + its left side up: leaning to its right) */
  lean?: number;
  /** let down on its legs in balance, upright (m; − up onto its toes, a person's), as far as they bend: about 0.6 m for the default
   * person, a deep crouch on both feet and the nearest a body comes to kneeling */
  lower?: number;
  /** the head turned on its neck over where its eyes look (rad): `pitch` + chin down (a nod), `yaw` + to its left, `roll` + its left
   * side up (tipped toward its right shoulder) */
  head?: { pitch?: number; yaw?: number; roll?: number };
  /** a person's arms posed over their hang and swing, each its own (`ArmPosture`) */
  arms?: { left?: ArmPosture; right?: ArmPosture };
  /** a person's fingers, each hand's shape: not added onto anything but taken as asked, by a hand holding nothing and no older than a
   * `grab` bringing it (a pose running under a story is how its hands rest: a grab takes them from it, and they go back to it as they let go) */
  fingers?: { left?: HandShape; right?: HandShape };
}

/**
 * An arm posed over its hang and swing (rad, each the same way for either arm), a person's: a hand verb (`reach`, `grab`, `carry`,
 * `track`) or a thing in the hand takes the arm over, and it comes back to the pose once the hand is free. Raised, the arm's upper part
 * turns from hanging: `forward` + ahead and up (flexion: π/2 holds it out level ahead), `out` + away from the side and up (abduction: π/2
 * holds it out level sideways), then `twist` + about its own length so a bent forearm turns out and up (external rotation; − across the
 * body); `elbow` + bends the forearm (0 straight … about 2.5 fully bent), `shrug` + lifts the shoulder (≲ 0.5). A wave: `out` 1.3,
 * `twist` 1.4, the `elbow` swung between about 0.6 and 1.6 by poses of 0.4 s or more each (shorter ones come out smaller).
 */
export interface ArmPosture {
  shrug?: number;
  forward?: number;
  out?: number;
  twist?: number;
  elbow?: number;
}

/** A `Posture`'s trunk, each field given. */
type TrunkPosture = Required<Omit<Posture, 'head' | 'arms' | 'fingers'>>;
const UNPOSED: TrunkPosture = { bow: 0, twist: 0, lean: 0, lower: 0 };

/** What a body is asked to do with its stance this sub-step (see `Asks`), each field as it combines with the others asked. */
export type Asked = Partial<Pick<Asks, 'lower' | 'bow' | 'bowLimit' | 'bowRate' | 'twist' | 'twistRate' | 'hips' | 'stagger' | 'shift' | 'steady'>> & { posture?: TrunkPosture };

/**
 * How a body is asked to hold itself over its legs this sub-step — what each of its parts may ask at once and balance serves together:
 * let down or bowed for a reach, turned for an aim, shifted toward what a hand falls short of, held still, and posed as a story asks.
 * Each field combines one way: the deepest `lower` and `bow` (rising onto the toes only while none asks down), the least `bowLimit`, the
 * largest `twist`, `hips`, `twistRate`, `bowRate`, `shift` and `steady`, the last `stagger`; a `posture`, the one `pose` that has the
 * trunk's, is added onto them all. Balance takes what was asked at the start of its sub-step and clears it (so it acts on it a sub-step later).
 */
export class Asks {
  /** let the pelvis down by the knees (m; negative: up onto the toes) */
  lower = 0;
  /** bend the trunk forward at the hips and lower back (rad) */
  bow = 0;
  /** the most it bows preparing or carrying a load (rad) */
  bowLimit = Infinity;
  /** turn the chest off the standing facing (rad) */
  twist = 0;
  /** the most (rad/s) the twist is taken up at — 0: at balance's own pace, a squat's; an aim's quicker, tracking a turning look */
  twistRate = 0;
  /** the most (rad/s) the bow is taken up at — 0: at balance's own pace, a squat's; a throw's quicker */
  bowRate = 0;
  /** turn the pelvis off the standing facing (rad), the legs reaching from it, at `twistRate` (a throw's hips leading its chest) */
  hips = 0;
  /** each foot's home put this far ahead of where it stands (m, by leg, left first): a foot off it steps there (a throw's stride) */
  stagger: readonly number[] | null = null;
  /** standing, shift the weight this far (m, on the floor) within the feet: toward what a hand falls short of */
  shift: Vector3 | null = null;
  /** hold still (0 at ease … 1 aiming): its quiet life — breathing, sway, weight shifts — fades by it */
  steady = 0;
  /** where the request that has its legs asks them to take it */
  legGoal: LegGoal | null = null;
  /** where the request that has its eyes asks them to look, for a species whose posture turns its head (it has no neck chain) */
  look: Readonly<Vector3> | null = null;
  /** the trunk posed as a story asks (`pose`), over all the rest */
  readonly posture: TrunkPosture = { ...UNPOSED };

  /** `asked` on top of what it holds, each field combined by its rule */
  add(asked: Asked): void {
    const { lower, bow, bowLimit, bowRate, twist, twistRate, hips, stagger, shift, steady, posture } = asked;
    if (lower !== undefined) this.lower = deeper(this.lower, lower);
    if (bow !== undefined) this.bow = deeper(this.bow, bow);
    if (bowLimit !== undefined) this.bowLimit = Math.min(this.bowLimit, bowLimit);
    if (twist !== undefined && Math.abs(twist) > Math.abs(this.twist)) this.twist = twist;
    if (twistRate !== undefined) this.twistRate = Math.max(this.twistRate, twistRate);
    if (bowRate !== undefined) this.bowRate = Math.max(this.bowRate, bowRate);
    if (hips !== undefined && Math.abs(hips) > Math.abs(this.hips)) this.hips = hips;
    if (stagger) this.stagger = stagger;
    if (shift && shift.length() > (this.shift?.length() ?? 0)) this.shift = shift;
    if (steady !== undefined) this.steady = Math.max(this.steady, steady);
    if (posture) Object.assign(this.posture, posture);
  }

  /** what it holds, copied into `into`, and itself cleared */
  pass(into: Asks): Asks {
    [into.lower, into.bow, into.bowLimit, into.bowRate, into.twist, into.twistRate, into.hips, into.stagger, into.shift, into.steady, into.legGoal, into.look] =
      [this.lower, this.bow, this.bowLimit, this.bowRate, this.twist, this.twistRate, this.hips, this.stagger, this.shift, this.steady, this.legGoal, this.look];
    [this.lower, this.bow, this.bowLimit, this.bowRate, this.twist, this.twistRate, this.hips, this.stagger, this.shift, this.steady, this.legGoal, this.look] = [0, 0, Infinity, 0, 0, 0, 0, null, null, 0, null, null];
    Object.assign(into.posture, this.posture);
    Object.assign(this.posture, UNPOSED);
    return into;
  }
}

/** down (+) wins, the deepest; up (−) only while none asks down, the highest */
const deeper = (was: number, asked: number) => asked > 0 ? Math.max(was, asked) : was <= 0 ? Math.min(was, asked) : was;
