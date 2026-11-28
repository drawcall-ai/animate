import { type Expression, type SidedShape, weightsOf } from "./blendshapes"

/** The head turned (rad), as a humanoid's head hinges count: `yaw` + to its left, `pitch` + chin down, `roll` + tipped toward its right shoulder. */
export interface HeadTurn {
  yaw: number
  pitch: number
  roll: number
}

/** How a face is in an emotion: its held expression, and how the head, eyes, lids and mouth move with it. */
export interface Manner {
  expression: Expression
  /** muscles that fire on stressed words over the held expression: the emotion spikes with the voice */
  accent: Expression
  head: HeadTurn
  /** how much an accent nods the head, and how stiffly the head moves (1/s; higher: snappier) */
  nod: number
  stiffness: number
  /** how much and how fast the head sways idly, and how much it trembles (fast, small) */
  sway: number
  swaySpeed: number
  tremble: number
  /** seconds between blinks [least, most], and how fast a blink closes and opens (1: as tuned) */
  blinkEvery: readonly [number, number]
  blinkSpeed: number
  /** seconds between saccades [least, most] and how large; where the eyes rest and where they glance, [yaw, pitch] as a `Look` (rad) */
  saccadeEvery: readonly [number, number]
  saccade: number
  rest: readonly [number, number]
  glance: readonly [number, number]
  /** how far the upper lids rest lower (+) or higher (of a blink) */
  lid: number
  /** how wide the jaw opens in speech (1: as tuned) */
  articulation: number
  /** which way accents move the brows (+1 up, −1 down) */
  browAccent: number
  /** how much loudness drives the expression */
  loudness: number
}

/** a left and right pair of a shape */
const LR = (shape: SidedShape, left: number, right = left): Expression => ({ [`${shape}Left`]: left, [`${shape}Right`]: right })

const neutral: Manner = {
  expression: LR("mouthSmile", 0.12, 0.11),
  accent: { browInnerUp: 0.15, ...LR("browOuterUp", 0.25) },
  head: { yaw: 0, pitch: 0, roll: 0 },
  nod: 1,
  stiffness: 14,
  sway: 1,
  swaySpeed: 1,
  tremble: 0,
  blinkEvery: [3, 6],
  blinkSpeed: 1,
  saccadeEvery: [0.5, 2],
  saccade: 1,
  rest: [0, 0],
  glance: [0.35, -0.18],
  lid: 0,
  articulation: 1,
  browAccent: 1,
  loudness: 0,
}

/** each emotion's manner, as tuned at full intensity */
/** An emotion a face shows: one of `EMOTIONS`. */
export type Emotion = "neutral" | "happy" | "angry" | "sad" | "scared" | "disgusted" | "surprised"

export const MANNER: Record<Emotion, Manner> = {
  neutral,
  happy: {
    ...neutral,
    expression: {
      ...LR("mouthSmile", 0.8, 0.7),
      ...LR("cheekSquint", 0.7, 0.6),
      ...LR("eyeSquint", 0.25),
      ...LR("browOuterUp", 0.3),
      browInnerUp: 0.15,
      mouthShrugUpper: 0.1,
    },
    accent: { ...LR("cheekSquint", 0.35), ...LR("mouthSmile", 0.25), ...LR("browOuterUp", 0.45), browInnerUp: 0.3 },
    head: { yaw: 0, pitch: -0.06, roll: 0 },
    nod: 1.4,
    stiffness: 15,
    sway: 1.4,
    swaySpeed: 1.3,
    blinkEvery: [2.5, 5],
    articulation: 1.15,
    loudness: 0.5,
  },
  angry: {
    ...neutral,
    expression: {
      ...LR("browDown", 1),
      ...LR("noseSneer", 0.45),
      ...LR("eyeSquint", 0.45),
      ...LR("mouthPress", 0.2),
      ...LR("mouthFrown", 0.35),
      ...LR("mouthUpperUp", 0.15),
      jawForward: 0.15,
      mouthShrugLower: 0.15,
    },
    accent: { ...LR("browDown", 0.4), ...LR("noseSneer", 0.5), ...LR("mouthUpperUp", 0.3), ...LR("eyeSquint", 0.25), ...LR("eyeWide", 0.25) },
    head: { yaw: 0, pitch: 0.03, roll: 0 },
    nod: 1.4,
    stiffness: 26,
    sway: 0.3,
    swaySpeed: 0.8,
    blinkEvery: [5, 9],
    saccadeEvery: [1.5, 3.5],
    saccade: 0.5,
    glance: [0.15, 0],
    lid: 0.03,
    articulation: 1.3,
    browAccent: -1,
    loudness: 0.7,
  },
  sad: {
    ...neutral,
    expression: {
      browInnerUp: 1.1,
      ...LR("browDown", 0.25),
      ...LR("mouthFrown", 0.75),
      mouthShrugLower: 0.45,
      ...LR("mouthPress", 0.15),
      mouthRollLower: 0.08,
      ...LR("eyeSquint", 0.15),
    },
    accent: { browInnerUp: 0.4, mouthShrugLower: 0.35, ...LR("mouthFrown", 0.3), ...LR("eyeSquint", 0.2) },
    head: { yaw: 0, pitch: 0.14, roll: 0.06 },
    nod: 0.5,
    stiffness: 7,
    sway: 0.7,
    swaySpeed: 0.6,
    blinkEvery: [3, 5],
    blinkSpeed: 0.6,
    saccadeEvery: [1.5, 3],
    saccade: 0.6,
    rest: [0.05, 0.08],
    glance: [0.2, 0.18],
    lid: 0.06,
    articulation: 0.8,
    browAccent: 0.4,
    loudness: 0,
  },
  scared: {
    ...neutral,
    expression: {
      browInnerUp: 1.1,
      ...LR("browOuterUp", 0.8),
      ...LR("eyeWide", 0.9),
      ...LR("mouthStretch", 0.55),
      ...LR("mouthFrown", 0.2),
      ...LR("browDown", 0.15),
      mouthShrugLower: 0.15,
    },
    accent: { browInnerUp: 0.35, ...LR("eyeWide", 0.4), ...LR("mouthStretch", 0.35), ...LR("browOuterUp", 0.3) },
    head: { yaw: 0.03, pitch: 0.04, roll: 0 },
    nod: 0.8,
    stiffness: 20,
    sway: 0.6,
    swaySpeed: 1.6,
    tremble: 0.007,
    blinkEvery: [1.2, 2.5],
    blinkSpeed: 1.3,
    saccadeEvery: [0.2, 0.6],
    saccade: 2.4,
    glance: [0.3, -0.3],
    lid: -0.2,
    articulation: 1.05,
    browAccent: 1,
    loudness: 0.3,
  },
  disgusted: {
    ...neutral,
    expression: {
      ...LR("noseSneer", 0.55, 0.65),
      ...LR("mouthUpperUp", 0.3, 0.4),
      ...LR("browDown", 0.55),
      ...LR("cheekSquint", 0.45, 0.55),
      ...LR("eyeSquint", 0.4),
      mouthShrugLower: 0.35,
      ...LR("mouthFrown", 0.3),
      ...LR("mouthPress", 0.1),
    },
    accent: { ...LR("noseSneer", 0.25), ...LR("mouthUpperUp", 0.25), ...LR("browDown", 0.25), mouthShrugLower: 0.25, ...LR("eyeSquint", 0.25) },
    head: { yaw: -0.07, pitch: 0.03, roll: -0.05 },
    nod: 1,
    stiffness: 12,
    sway: 0.6,
    swaySpeed: 0.8,
    blinkEvery: [2.5, 5],
    saccadeEvery: [1, 2.5],
    saccade: 0.8,
    rest: [0.06, 0.03],
    glance: [0.35, 0.1],
    lid: 0.08,
    articulation: 1.1,
    browAccent: -0.6,
    loudness: 0.4,
  },
  surprised: {
    ...neutral,
    expression: { browInnerUp: 1, ...LR("browOuterUp", 1), ...LR("eyeWide", 0.8), ...LR("mouthSmile", 0.15) },
    accent: { browInnerUp: 0.4, ...LR("browOuterUp", 0.5), ...LR("eyeWide", 0.4), jawOpen: 0.04 },
    head: { yaw: 0, pitch: -0.08, roll: 0 },
    nod: 1.3,
    stiffness: 18,
    sway: 1.1,
    swaySpeed: 1.2,
    saccadeEvery: [0.6, 1.5],
    saccade: 1.2,
    glance: [0.25, -0.15],
    lid: -0.15,
    articulation: 1.2,
    browAccent: 1,
    loudness: 0.5,
  },
}

/** Whether `name` is an emotion a face shows. */
export const isEmotion = (name: string): name is Emotion => Object.hasOwn(MANNER, name)
/** The emotions a face shows. */
export const EMOTIONS: readonly Emotion[] = Object.keys(MANNER).filter(isEmotion)

/** A quick expression on a single word of a line: one of `REACTIONS`. */
export type Reaction = "browFlash" | "smirk" | "wince" | "sneer" | "gasp"

/** each quick expression for a single word */
export const REACTION: Record<Reaction, Expression> = {
  browFlash: { browInnerUp: 0.8, ...LR("browOuterUp", 1), ...LR("eyeWide", 0.3) },
  smirk: { mouthSmileRight: 0.7, cheekSquintRight: 0.5, mouthDimpleRight: 0.3, eyeSquintRight: 0.2, browOuterUpRight: 0.3 },
  wince: { ...LR("eyeSquint", 0.8), ...LR("browDown", 0.7), ...LR("noseSneer", 0.5), ...LR("mouthStretch", 0.45), ...LR("cheekSquint", 0.6) },
  sneer: { noseSneerRight: 0.5, mouthUpperUpRight: 0.45, cheekSquintRight: 0.4, browDownRight: 0.3 },
  gasp: { browInnerUp: 0.9, ...LR("browOuterUp", 0.9), ...LR("eyeWide", 1), jawOpen: 0.12 },
}

export const isReaction = (name: string): name is Reaction => Object.hasOwn(REACTION, name)
/** The quick expressions on single words of a line. */
export const REACTIONS: readonly Reaction[] = Object.keys(REACTION).filter(isReaction)

/** `parts` weighted over `base`, which takes what their weights leave of 1 (they are scaled down to 1 if they sum past it). */
export function blend(parts: readonly (readonly [Manner, number])[], base: Manner = neutral): Manner {
  const sum = parts.reduce((a, [, w]) => a + w, 0),
    total = Math.min(1, sum)
  const all: (readonly [Manner, number])[] = [[base, 1 - total], ...parts.map(([m, w]) => [m, total ? (w / sum) * total : 0] as const)]
  const num = (f: (m: Manner) => number) => all.reduce((a, [m, w]) => a + f(m) * w, 0)
  const pair = (f: (m: Manner) => readonly [number, number]): [number, number] => [num((m) => f(m)[0]), num((m) => f(m)[1])]
  const shapes = (f: (m: Manner) => Expression) => {
    const out: Expression = {}
    for (const [m, w] of all) for (const [k, v] of weightsOf(f(m))) out[k] = (out[k] ?? 0) + v * w
    return out
  }
  return {
    expression: shapes((m) => m.expression),
    accent: shapes((m) => m.accent),
    head: { yaw: num((m) => m.head.yaw), pitch: num((m) => m.head.pitch), roll: num((m) => m.head.roll) },
    nod: num((m) => m.nod),
    stiffness: num((m) => m.stiffness),
    sway: num((m) => m.sway),
    swaySpeed: num((m) => m.swaySpeed),
    tremble: num((m) => m.tremble),
    blinkEvery: pair((m) => m.blinkEvery),
    blinkSpeed: num((m) => m.blinkSpeed),
    saccadeEvery: pair((m) => m.saccadeEvery),
    saccade: num((m) => m.saccade),
    rest: pair((m) => m.rest),
    glance: pair((m) => m.glance),
    lid: num((m) => m.lid),
    articulation: num((m) => m.articulation),
    browAccent: num((m) => m.browAccent),
    loudness: num((m) => m.loudness),
  }
}
