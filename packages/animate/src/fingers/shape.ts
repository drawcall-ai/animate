/**
 * How one finger is bent, each 0 … 1: `curl` folds all three joints together as the tendons couple them from straight along the palm,
 * however its rig rests it (0: straight; 1: a fist's), and below 0, to `LIFTED`, lifts it back at the knuckle alone a little past straight,
 * as a trigger finger laid flat along a receiver; `hook` folds only the two end joints on top, the
 * knuckle held (a curl of 0 with a hook of 1 hooks the fingertips over a bag's handle); `spread` fans it away from the middle finger at the
 * knuckle (1: as far as it goes; the middle finger has none).
 */
export interface Finger {
  curl?: number;
  hook?: number;
  spread?: number;
}

/**
 * How the thumb is held, each 0 … 1: `curl` folds its two outer joints; `oppose` swings it from beside the index (0) across the palm (1),
 * and below 0, to `SPLAYED`, back out of the palm past how its rig rests it — a rig's rest thumb is often a little across the palm — to
 * clear a handle the palm lies on, as a thumb along a receiver's side beside the hand.
 */
export interface Thumb {
  curl?: number;
  oppose?: number;
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
/** the least a finger's `curl` goes: lifted back at the knuckle past straight 0.15 of a fist's bend there */
export const LIFTED = -0.15;
/** the least a thumb's `oppose` goes: swung back out of the palm 0.8 of the way it swings across */
export const SPLAYED = -0.8;
export type DigitName = (typeof DIGITS)[number];

/** `Fingers` with every digit and value given */
export type Shape = { thumb: Required<Thumb> } & Record<DigitName, Required<Finger>>;

const digit = (curl: number, hook = 0, spread = 0): Required<Finger> => ({ curl, hook, spread });

/** A hand at rest: each finger a little more curled than the one before it, the little finger most, the thumb beside the index. */
export const RELAXED = {
  thumb: { curl: 0.2, oppose: 0.25 }, index: digit(0.16, 0.05, 0.1), middle: digit(0.22, 0.06), ring: digit(0.28, 0.07, 0.1), little: digit(0.34, 0.08, 0.15),
} as const satisfies Shape;
/** Every finger folded into the palm, the thumb across them. */
export const FIST = { thumb: { curl: 0.7, oppose: 0.75 }, index: digit(1), middle: digit(1), ring: digit(1), little: digit(1) } as const satisfies Shape;
/** Every finger straight, fanned a little. */
export const OPEN = {
  thumb: { curl: 0, oppose: 0 }, index: digit(0, 0, 0.3), middle: digit(0), ring: digit(0, 0, 0.3), little: digit(0, 0, 0.4),
} as const satisfies Shape;
/** The index pointing, the other fingers folded under the thumb. */
export const POINT = { ...FIST, index: digit(0) } as const satisfies Shape;
/** The fingers folded, the thumb up. */
export const THUMBS_UP = { ...FIST, thumb: { curl: 0, oppose: 0 } } as const satisfies Shape;

/** `fingers` over `base`: each value given replaces `base`'s; out of 0 … 1 (a finger's curl `LIFTED` … 1, a thumb's oppose `SPLAYED` … 1) is a
 * misuse, said at once */
export function shapeOf(fingers: Fingers, base: Shape = RELAXED): Shape {
  for (const [name, values] of Object.entries(fingers)) {
    if (name !== 'thumb' && !DIGITS.some((digit) => digit === name)) throw new Error(`fingers: a hand has a thumb, ${DIGITS.join(', ')}; not "${name}"`);
    if (typeof values !== 'object' || values === null) throw new Error(`fingers: ${name} ${String(values)} is no digit's values`);
    const keys = name === 'thumb' ? ['curl', 'oppose'] : ['curl', 'hook', 'spread'];
    for (const [key, value] of Object.entries(values)) {
      if (!keys.includes(key)) throw new Error(`fingers: a ${name === 'thumb' ? 'thumb' : 'finger'} takes ${keys.join(', ')}; not "${key}"`);
      const least = key === 'curl' ? (name === 'thumb' ? 0 : LIFTED) : key === 'oppose' ? SPLAYED : 0;
      if (!(typeof value === 'number' && value >= least && value <= 1)) throw new Error(`fingers: ${name} ${key} ${String(value)} is not ${least} … 1`);
    }
  }
  return {
    thumb: { ...base.thumb, ...fingers.thumb },
    index: { ...base.index, ...fingers.index }, middle: { ...base.middle, ...fingers.middle },
    ring: { ...base.ring, ...fingers.ring }, little: { ...base.little, ...fingers.little },
  };
}

/** `shape` eased `seconds` on toward `goal` in place: about two thirds of the way in `EASE` (a fist closes from open in about a quarter second) */
export function easeShape(shape: Shape, goal: Shape, seconds: number): void {
  const k = 1 - Math.exp(-seconds / EASE);
  shape.thumb.curl += (goal.thumb.curl - shape.thumb.curl) * k;
  shape.thumb.oppose += (goal.thumb.oppose - shape.thumb.oppose) * k;
  for (const name of DIGITS) {
    const at = shape[name], to = goal[name];
    at.curl += (to.curl - at.curl) * k;
    at.hook += (to.hook - at.hook) * k;
    at.spread += (to.spread - at.spread) * k;
  }
}

/** how quickly fingers take up a new shape (s): their time constant */
const EASE = 0.07;
