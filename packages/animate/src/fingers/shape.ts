/**
 * How one finger is bent, each 0 … 1: `curl` folds all three joints together as the tendons couple them from straight along the palm,
 * however its rig rests it (0: straight; 1: a fist's), and below 0, to `LIFTED`, lifts it back at the knuckle alone a little past straight,
 * as a trigger finger laid flat along a receiver; `hook` folds only the two end joints on top, the knuckle held (a curl of 0 with a hook of
 * 1 hooks the fingertips over a bag's handle); `spread` fans it away from the middle finger at the knuckle (1: as far as it goes; the
 * middle finger has none).
 */
export interface Finger {
  curl?: number;
  hook?: number;
  spread?: number;
}

/**
 * How the thumb is held, each 0 … 1: `curl` folds its two outer joints; `oppose` swings it at its base across the palm toward the little
 * finger, from beside the index (0); `spread` lifts it out in front of the palm, away from the palm's plane (0: in it). Wrapping a handle
 * takes both, the thumb out round the handle and across onto its far side; laid along a face beside the hand, neither. Each goes below
 * 0, to `SPLAYED`, back past how its rig rests it — a rig's rest thumb is often a little across and in front of the palm.
 */
export interface Thumb {
  curl?: number;
  oppose?: number;
  spread?: number;
}

/** A hand's fingers, each digit as `Finger` or `Thumb` has it, a digit left out as relaxed (`RELAXED`). */
export interface Fingers {
  thumb?: Thumb;
  index?: Finger;
  middle?: Finger;
  ring?: Finger;
  little?: Finger;
}

export const DIGITS = ['index', 'middle', 'ring', 'little'] as const;
export type DigitName = (typeof DIGITS)[number];
export type Digit = 'thumb' | DigitName;
/** the least a finger's `curl` goes: lifted back at the knuckle past straight 0.15 of a fist's bend there */
export const LIFTED = -0.15;
/** the least a thumb's `oppose` and `spread` go: back 0.8 of the way they swing it across and out */
export const SPLAYED = -0.8;

/** `Fingers` with every digit and value given */
export type Shape = { thumb: Required<Thumb> } & Record<DigitName, Required<Finger>>;

const digit = (curl: number, hook = 0, spread = 0): Required<Finger> => ({ curl, hook, spread });

/** A hand at rest: each finger a little more curled than the one before it, the little finger most, the thumb beside the index. */
export const RELAXED = {
  thumb: { curl: 0.2, oppose: 0.12, spread: 0.25 }, index: digit(0.16, 0.05, 0.1), middle: digit(0.22, 0.06), ring: digit(0.28, 0.07, 0.1), little: digit(0.34, 0.08, 0.15),
} as const satisfies Shape;
/** Every finger folded into the palm, the thumb across them. */
export const FIST = { thumb: { curl: 0.7, oppose: 0.7, spread: 0.5 }, index: digit(1), middle: digit(1), ring: digit(1), little: digit(1) } as const satisfies Shape;
/** Every finger straight, fanned a little. */
export const OPEN = {
  thumb: { curl: 0, oppose: 0, spread: 0 }, index: digit(0, 0, 0.3), middle: digit(0), ring: digit(0, 0, 0.3), little: digit(0, 0, 0.4),
} as const satisfies Shape;
/** The index pointing, the other fingers folded under the thumb. */
export const POINT = { ...FIST, index: digit(0) } as const satisfies Shape;
/** The fingers folded, the thumb up. */
export const THUMBS_UP = { ...FIST, thumb: { curl: 0, oppose: 0, spread: 0 } } as const satisfies Shape;

/** `fingers` over `base`: each value given replaces `base`'s; out of 0 … 1 (a finger's curl `LIFTED` … 1, a thumb's oppose and spread
 * `SPLAYED` … 1) is a misuse, said at once */
export function shapeOf(fingers: Fingers, base: Shape = RELAXED): Shape {
  for (const [name, values] of Object.entries(fingers)) {
    const digit = digitOf(name, 'fingers');
    if (typeof values !== 'object' || values === null) throw new Error(`fingers: ${name} ${String(values)} is no digit's values`);
    const keys = digit === 'thumb' ? ['curl', 'oppose', 'spread'] : ['curl', 'hook', 'spread'];
    for (const [key, value] of Object.entries(values)) {
      if (!keys.includes(key)) throw new Error(`fingers: a ${digit === 'thumb' ? 'thumb' : 'finger'} takes ${keys.join(', ')}; not "${key}"`);
      const least = digit === 'thumb' ? (key === 'curl' ? 0 : SPLAYED) : key === 'curl' ? LIFTED : 0;
      if (!(typeof value === 'number' && value >= least && value <= 1)) throw new Error(`fingers: ${name} ${key} ${String(value)} is not ${least} … 1`);
    }
  }
  return {
    thumb: { ...base.thumb, ...fingers.thumb },
    index: { ...base.index, ...fingers.index }, middle: { ...base.middle, ...fingers.middle },
    ring: { ...base.ring, ...fingers.ring }, little: { ...base.little, ...fingers.little },
  };
}

/** `name` as a digit; another is a misuse, said at once (`what`: what named it) */
export function digitOf(name: unknown, what: string): Digit {
  const digit = (['thumb', ...DIGITS] as const).find((d) => d === name);
  if (digit === undefined) throw new Error(`${what}: a hand has a thumb, ${DIGITS.join(', ')}; not "${String(name)}"`);
  return digit;
}

/** `shape` eased `seconds` on toward `goal` in place: about two thirds of the way in `EASE` (a fist closes from open in about a quarter second) */
export function easeShape(shape: Shape, goal: Shape, seconds: number): void {
  const k = 1 - Math.exp(-seconds / EASE);
  shape.thumb.curl += (goal.thumb.curl - shape.thumb.curl) * k;
  shape.thumb.oppose += (goal.thumb.oppose - shape.thumb.oppose) * k;
  shape.thumb.spread += (goal.thumb.spread - shape.thumb.spread) * k;
  for (const name of DIGITS) {
    const at = shape[name], to = goal[name];
    at.curl += (to.curl - at.curl) * k;
    at.hook += (to.hook - at.hook) * k;
    at.spread += (to.spread - at.spread) * k;
  }
}

/** `from` the share `t` (0 … 1) of the way to `to`, every value */
export function blendShape(from: Shape, to: Shape, t: number): Shape {
  const mix = (a: number, b: number) => a + (b - a) * t;
  const finger = (a: Required<Finger>, b: Required<Finger>) => ({ curl: mix(a.curl, b.curl), hook: mix(a.hook, b.hook), spread: mix(a.spread, b.spread) });
  return {
    thumb: { curl: mix(from.thumb.curl, to.thumb.curl), oppose: mix(from.thumb.oppose, to.thumb.oppose), spread: mix(from.thumb.spread, to.thumb.spread) },
    index: finger(from.index, to.index), middle: finger(from.middle, to.middle), ring: finger(from.ring, to.ring), little: finger(from.little, to.little),
  };
}

/** how quickly fingers take up a new shape (s): their time constant */
const EASE = 0.07;
