import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

/**
 * Where the parts of the rifle are, counted from the butt of its stock: z toward the muzzle, y up, x to his left (m).
 * `right` and `left` are where the wrists are with the hands on the pistol grip and under the foregrip.
 */
export const RIFLE = {
  grip: new Vector3(0, -0.07, 0.26),
  trigger: new Vector3(0, -0.035, 0.315),
  fore: new Vector3(0, -0.04, 0.52),
  well: new Vector3(0, -0.05, 0.38),
  sight: new Vector3(0, 0.06, 0.25),
  muzzle: new Vector3(0, 0, 0.8),
  right: new Vector3(-0.015, -0.115, 0.2),
  left: new Vector3(0.03, -0.085, 0.42),
}
/** how long a magazine is, hanging down out of the well, and how thick (m) */
export const MAGAZINE = { long: 0.15, wide: 0.025, deep: 0.05 }

/** where the left wrist is from the top of the magazine it has hold of, in the rifle's frame (m) */
export const MAGAZINE_WRIST = new Vector3(0.05, -0.17, -0.05)

/** the boxes a rifle is made of: the middle of each, and how wide, high and long it is */
const BOXES: [x: number, y: number, z: number, wide: number, high: number, long: number, color: number][] = [
  [0, -0.01, 0.1, 0.035, 0.07, 0.2, 0x3a3a34], // stock
  [0, 0, 0.32, 0.04, 0.07, 0.26, 0x2a2a2a], // body
  [0, 0, 0.62, 0.02, 0.02, 0.36, 0x1a1a1a], // barrel
  [0, -0.02, 0.52, 0.045, 0.045, 0.16, 0x3a3a34], // foregrip: the handguard under the barrel
  [0, -0.085, 0.25, 0.03, 0.1, 0.035, 0x2a2a2a], // pistol grip
  [0, -0.045, 0.315, 0.008, 0.025, 0.008, 0xc0c0c0], // trigger
  [0, 0.05, 0.25, 0.01, 0.03, 0.02, 0x1a1a1a], // rear sight
  [0, 0.03, 0.78, 0.008, 0.04, 0.008, 0x1a1a1a], // front sight
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
  for (const [x, y, z, wide, high, long, color] of BOXES) {
    const box = new Mesh(new BoxGeometry(wide, high, long), new MeshStandardMaterial({ color }))
    box.position.set(x, y, z)
    made.add(box)
  }
  return made
}
