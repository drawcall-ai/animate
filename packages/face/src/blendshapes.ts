// ARKit's 52 blendshapes, the standard a face is driven by.

const SIDED = [
  "eyeBlink",
  "eyeLookDown",
  "eyeLookIn",
  "eyeLookOut",
  "eyeLookUp",
  "eyeSquint",
  "eyeWide",
  "mouthSmile",
  "mouthFrown",
  "mouthDimple",
  "mouthStretch",
  "mouthPress",
  "mouthLowerDown",
  "mouthUpperUp",
  "browDown",
  "browOuterUp",
  "cheekSquint",
  "noseSneer",
] as const
const CENTRAL = [
  "jawForward",
  "jawLeft",
  "jawRight",
  "jawOpen",
  "mouthClose",
  "mouthFunnel",
  "mouthPucker",
  "mouthLeft",
  "mouthRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "browInnerUp",
  "cheekPuff",
  "tongueOut",
] as const

/** a blendshape that comes as a left and a right one */
export type SidedShape = (typeof SIDED)[number]
/** An ARKit blendshape; `Left` and `Right` are the character's own. */
export type BlendShape = `${SidedShape}${"Left" | "Right"}` | (typeof CENTRAL)[number]

/** ARKit's 52 blendshapes. */
export const BLEND_SHAPES: readonly BlendShape[] = [...SIDED.flatMap((shape) => [`${shape}Left` as const, `${shape}Right` as const]), ...CENTRAL]

const NAMES = new Set<string>(BLEND_SHAPES)
export const isBlendShape = (name: string): name is BlendShape => NAMES.has(name)

/** Blendshape weights, ARKit's range being 0…1; a shape left out is at 0. */
export type Expression = Partial<Record<BlendShape, number>>

/** Adds `value` to a weight, absent counting as 0. */
export const add = (expression: Expression, name: BlendShape, value: number) => {
  expression[name] = (expression[name] ?? 0) + value
}

/** the weights an expression gives, by shape */
export const weightsOf = (expression: Readonly<Expression>): (readonly [BlendShape, number])[] =>
  BLEND_SHAPES.flatMap((name) => {
    const weight = expression[name]
    return weight === undefined ? [] : [[name, weight] as const]
  })
