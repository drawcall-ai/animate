import type { Vector3 } from 'three';

/** What a body is asked to do with its stance this sub-step (see `Poise`), each field as it combines with the others asked. */
export type Asked = Partial<Pick<Poise, 'lower' | 'bow' | 'bowLimit' | 'twist' | 'twistRate' | 'lean' | 'steady'>>;

/**
 * How a body is asked to hold itself over its legs this sub-step — what each of its parts may ask at once and balance serves together:
 * let down or bowed for a reach, turned for an aim, shifted toward what a hand falls short of, held still. Each field combines one way:
 * the deepest `lower` and `bow` (rising onto the toes only while none asks down), the least `bowLimit`, the largest `twist`, `twistRate`,
 * `lean` and `steady`. Balance takes what was asked at the start of its sub-step and clears it (so it acts on it a sub-step later).
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
  lean: Vector3 | null = null;
  /** hold still (0 at ease … 1 aiming): its quiet life — breathing, sway, weight shifts — fades by it */
  steady = 0;

  /** `asked` on top of what it holds, each field combined by its rule */
  add(asked: Asked): void {
    const { lower, bow, bowLimit, twist, twistRate, lean, steady } = asked;
    if (lower !== undefined) this.lower = deeper(this.lower, lower);
    if (bow !== undefined) this.bow = deeper(this.bow, bow);
    if (bowLimit !== undefined) this.bowLimit = Math.min(this.bowLimit, bowLimit);
    if (twist !== undefined && Math.abs(twist) > Math.abs(this.twist)) this.twist = twist;
    if (twistRate !== undefined) this.twistRate = Math.max(this.twistRate, twistRate);
    if (lean && lean.length() > (this.lean?.length() ?? 0)) this.lean = lean;
    if (steady !== undefined) this.steady = Math.max(this.steady, steady);
  }

  /** what it holds, copied into `into`, and itself cleared */
  pass(into: Poise): Poise {
    [into.lower, into.bow, into.bowLimit, into.twist, into.twistRate, into.lean, into.steady] = [this.lower, this.bow, this.bowLimit, this.twist, this.twistRate, this.lean, this.steady];
    [this.lower, this.bow, this.bowLimit, this.twist, this.twistRate, this.lean, this.steady] = [0, 0, Infinity, 0, 0, null, 0];
    return into;
  }
}

/** down (+) wins, the deepest; up (−) only while none asks down, the highest */
const deeper = (was: number, asked: number) => asked > 0 ? Math.max(was, asked) : was <= 0 ? Math.min(was, asked) : was;
