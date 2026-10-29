import type { Vector3 } from 'three';

/**
 * A posture authored over whatever the body is doing (`pose`), as an additive layer or an aim offset is in a game engine: each field is
 * added onto what the body's own tasks ask (a reach's bow, an aim's turn), held in balance, as far as its joints allow. Radians by the
 * right-hand rule about the body's axes (+X its left, +Y up, +Z ahead), metres for `lower`; a field left out is 0.
 */
export interface Posture {
  /** the trunk bowed forward at the hips and back (rad, + forward; − arches it back, the chest lifting) */
  bow?: number;
  /** the chest turned off the hips (rad, + to its left) */
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
export type TrunkPosture = Required<Omit<Posture, 'head' | 'arms'>>;

/** What a body is asked to do with its stance this sub-step (see `Poise`), each field as it combines with the others asked. */
export type Asked = Partial<Pick<Poise, 'lower' | 'bow' | 'bowLimit' | 'twist' | 'twistRate' | 'shift' | 'steady'>> & { posture?: TrunkPosture };

/**
 * How a body is asked to hold itself over its legs this sub-step — what each of its parts may ask at once and balance serves together:
 * let down or bowed for a reach, turned for an aim, shifted toward what a hand falls short of, held still, and posed as a story asks.
 * Each field combines one way: the deepest `lower` and `bow` (rising onto the toes only while none asks down), the least `bowLimit`, the
 * largest `twist`, `twistRate`, `shift` and `steady`; a `posture` is summed and added onto them all. Balance takes what was asked at the
 * start of its sub-step and clears it (so it acts on it a sub-step later).
 */
export class Poise {
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
  /** standing, shift the weight this far (m, on the floor) within the feet: toward what a hand falls short of */
  shift: Vector3 | null = null;
  /** hold still (0 at ease … 1 aiming): its quiet life — breathing, sway, weight shifts — fades by it */
  steady = 0;
  /** the trunk posed as a story asks (`pose`), over all the rest */
  readonly posture: TrunkPosture = { bow: 0, twist: 0, lean: 0, lower: 0 };

  /** `asked` on top of what it holds, each field combined by its rule */
  add(asked: Asked): void {
    const { lower, bow, bowLimit, twist, twistRate, shift, steady, posture } = asked;
    if (lower !== undefined) this.lower = deeper(this.lower, lower);
    if (bow !== undefined) this.bow = deeper(this.bow, bow);
    if (bowLimit !== undefined) this.bowLimit = Math.min(this.bowLimit, bowLimit);
    if (twist !== undefined && Math.abs(twist) > Math.abs(this.twist)) this.twist = twist;
    if (twistRate !== undefined) this.twistRate = Math.max(this.twistRate, twistRate);
    if (shift && shift.length() > (this.shift?.length() ?? 0)) this.shift = shift;
    if (steady !== undefined) this.steady = Math.max(this.steady, steady);
    if (posture) for (const key of TRUNK) this.posture[key] += posture[key];
  }

  /** what it holds, copied into `into`, and itself cleared */
  pass(into: Poise): Poise {
    [into.lower, into.bow, into.bowLimit, into.twist, into.twistRate, into.shift, into.steady] = [this.lower, this.bow, this.bowLimit, this.twist, this.twistRate, this.shift, this.steady];
    [this.lower, this.bow, this.bowLimit, this.twist, this.twistRate, this.shift, this.steady] = [0, 0, Infinity, 0, 0, null, 0];
    for (const key of TRUNK) {
      into.posture[key] = this.posture[key];
      this.posture[key] = 0;
    }
    return into;
  }
}

const TRUNK = ['bow', 'twist', 'lean', 'lower'] as const satisfies readonly (keyof TrunkPosture)[];

/** down (+) wins, the deepest; up (−) only while none asks down, the highest */
const deeper = (was: number, asked: number) => asked > 0 ? Math.max(was, asked) : was <= 0 ? Math.min(was, asked) : was;
