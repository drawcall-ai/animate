import { grip, type Hand, point, type Statement } from '@drawcall/hand'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three'

/**
 * the arm the rifle is drawn for, from shoulder to wrist (m): for a man whose arm is another length it is drawn as much
 * larger, as are the places it is carried at, so that his hands reach it as this arm does
 */
export const ARM = 0.61
/**
 * Where the parts of the rifle are, counted from the butt of its stock: z toward the muzzle, y up, x to his left (m).
 * `grip` is the top and the foot of the pistol grip's back, where the palm meets it, and `trigger` the trigger's back.
 */
export const RIFLE = {
  butt: new Vector3(),
  grip: { top: new Vector3(0, -0.035, 0.2325), foot: new Vector3(0, -0.135, 0.2325) },
  trigger: new Vector3(0, -0.045, 0.311),
  well: new Vector3(0, -0.05, 0.38),
  sight: new Vector3(0, 0.06, 0.25),
  muzzle: new Vector3(0, 0, 0.8),
}
/** how wide and how long the grip under the handguard is (m) */
const FORE = { wide: 0.03, long: 0.08 }
/** how long a magazine is, hanging down out of the well, and how thick (m) */
export const MAGAZINE = { long: 0.15, wide: 0.025, deep: 0.05 }

/** how far apart the places along a grip are that a hand is tried at (m) */
const STEP = 0.005
/**
 * how the left hand takes hold of the magazine: from his side, the palm on its flank and the fingers hooked round its
 * front, the thumb left out, as across so thin a thing a thumb presses on the side of the fingers and not against them
 */
export const HOLD = {
  magazine: {
    at: new Vector3(MAGAZINE.wide / 2, -MAGAZINE.long / 2, 0),
    from: new Vector3(1, 0, 0),
    using: ['palm', 'index', 'middle', 'ring', 'little'],
  },
} satisfies Record<string, Statement>

/**
 * A grip taken at the first of some places a hand holds at: where along a grip that is depends on how the hand is
 * made, where its thumb has its root and how wide it is against the grip's length. Throws if it holds at none.
 */
function first<T>(hand: Hand, what: string, places: Vector3[], take: (at: Vector3) => T) {
  const errors: string[] = []
  for (const at of places) {
    try {
      return take(at)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`the ${hand.side} hand holds the ${what} nowhere along it: ${errors.at(-1)}`)
}
/** places a step apart from `from` to `to` */
const down = (from: Vector3, to: Vector3) =>
  Array.from({ length: Math.floor(from.distanceTo(to) / STEP) + 1 }, (_, k) =>
    from.clone().lerp(to, (k * STEP) / from.distanceTo(to)),
  )

/**
 * How the right hand takes the pistol grip: from behind, as high under the receiver as it holds, the web of the thumb up
 * in the tang as a shooter has it, the index lying along the frame; and with that index on the trigger, the rest kept.
 */
export function pistol(hand: Hand, rifle: Object3D) {
  const from = new Vector3(-1, 0, -0.5).normalize()
  const using = ['palm', 'thumb', 'middle', 'ring', 'little'] as const
  return first(hand, 'pistol grip', down(RIFLE.grip.top, RIFLE.grip.foot), (at) => {
    const held = grip(hand, rifle, { at, from, using, start: point })
    return { held, trigger: grip(hand, rifle, { at: RIFLE.trigger, using: ['index'], start: held }) }
  })
}

/**
 * How the left hand takes the grip under the handguard: round it from his side, as near its middle as it holds, on its
 * own, as the rifle's bulk behind it would turn the thumb back toward it.
 */
export function fore(hand: Hand, handle: Object3D) {
  const side = (y: number) => new Vector3(FORE.wide / 2, y, 0)
  const [up, under] = [down(side(0), side(FORE.long / 2)), down(side(0), side(-FORE.long / 2))]
  const places = up.flatMap((at, k) => [at, under[k]]).slice(1)
  return first(hand, 'grip under the handguard', places, (at) => grip(hand, handle, { at, from: new Vector3(1, 0, 0) }))
}

/**
 * the boxes a rifle is made of: the middle of each, how wide, high and long it is, and what it is. The left hand holds
 * an upright grip under the handguard, as round the handguard itself it has its fingers across the rifle, and a
 * forearm reaching forward along it cannot bend the wrist that far
 */
const BOXES: [
  x: number,
  y: number,
  z: number,
  wide: number,
  high: number,
  long: number,
  color: number,
  name: string,
][] = [
  [0, -0.01, 0.1, 0.035, 0.07, 0.2, 0x3a3a34, 'stock'],
  [0, 0, 0.32, 0.04, 0.07, 0.26, 0x2a2a2a, 'body'],
  [0, 0, 0.62, 0.02, 0.02, 0.36, 0x1a1a1a, 'barrel'],
  [0, -0.02, 0.52, 0.045, 0.045, 0.16, 0x3a3a34, 'handguard'],
  [0, -0.08, 0.48, FORE.wide, FORE.long, FORE.wide, 0x2a2a2a, 'fore'],
  [0, -0.085, 0.25, 0.03, 0.1, 0.035, 0x2a2a2a, 'grip'],
  [0, -0.045, 0.315, 0.008, 0.025, 0.008, 0xc0c0c0, 'trigger'],
  [0, 0.05, 0.25, 0.01, 0.03, 0.02, 0x1a1a1a, 'rear sight'],
  [0, 0.03, 0.78, 0.008, 0.04, 0.008, 0x1a1a1a, 'front sight'],
]

/** a magazine, hanging from the middle of its top */
export function magazine() {
  const drawn = new Mesh(
    new BoxGeometry(MAGAZINE.wide, MAGAZINE.long, MAGAZINE.deep),
    new MeshStandardMaterial({ color: 0x505048 }),
  )
  drawn.geometry.translate(0, -MAGAZINE.long / 2, 0)
  return drawn
}

/** A rifle of boxes, its butt at the origin and its muzzle along z, without its magazine. */
export function rifle() {
  const made = new Group()
  for (const [x, y, z, wide, high, long, color, name] of BOXES) {
    const box = new Mesh(new BoxGeometry(wide, high, long), new MeshStandardMaterial({ color }))
    box.position.set(x, y, z)
    box.name = name
    made.add(box)
  }
  return made
}
