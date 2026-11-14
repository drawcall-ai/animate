import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { type Panel, TRAVEL } from './actions'

/** how far from the middle of his hips he stays clear of a box (m) */
const GIRTH = 0.3
/** the boxes in his way: where the middle of each is on the ground, how far it reaches from there along x and along z, and how high it is (m): the first is the wall the panel is on */
const BOXES = [
  { x: 0, z: 6, wide: 3, long: 0.2, high: 2.4 },
  { x: 2.5, z: 2.5, wide: 0.5, long: 0.5, high: 1 },
  { x: -3, z: 3, wide: 1, long: 0.3, high: 0.6 },
  { x: -1, z: -4, wide: 0.4, long: 1.5, high: 1.4 },
]
/** the button: how thick it is, its radius, and how far it stands out of the wall (m) */
const BUTTON = { radius: 0.02, proud: 0.015 }
const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))

/** where the boxes let the middle of his hips be, that would be at a place: out of each, the shortest way */
export function clear({ x, z }: { x: number; z: number }) {
  for (const box of BOXES) {
    const [off, on] = [
      x - clamp(x, box.x - box.wide, box.x + box.wide),
      z - clamp(z, box.z - box.long, box.z + box.long),
    ]
    const far = Math.hypot(off, on)
    if (far >= GIRTH) continue
    // (in it, out by the nearer of its sides along x)
    if (far === 0) x = box.x + Math.sign(x - box.x || 1) * (box.wide + GIRTH)
    else [x, z] = [x + (off / far) * (GIRTH - far), z + (on / far) * (GIRTH - far)]
  }
  return { x, z }
}

/** The floor's boxes and the wall with its panel: what is drawn, the panel, and whether he is near enough to press its button: within an arm's length of it along the ground. */
export function level() {
  const wall = BOXES[0]
  const panel: Panel = {
    button: new Vector3(1, 1.3, wall.z - wall.long - BUTTON.proud),
    out: new Vector3(0, 0, -1),
    pressed: false,
  }
  const drawn = new Group()
  for (const box of BOXES) {
    const mesh = new Mesh(
      new BoxGeometry(2 * box.wide, box.high, 2 * box.long),
      new MeshStandardMaterial({ color: 0x607080 }),
    )
    mesh.position.set(box.x, box.high / 2, box.z)
    drawn.add(mesh)
  }
  const plate = new Mesh(new BoxGeometry(0.3, 0.3, 0.01), new MeshStandardMaterial({ color: 0x303840 }))
  plate.position.set(panel.button.x, panel.button.y, wall.z - wall.long - 0.005)
  const button = new Mesh(
    new CylinderGeometry(BUTTON.radius, BUTTON.radius, BUTTON.proud),
    new MeshStandardMaterial({ color: 0xd03030 }),
  )
  button.rotation.x = Math.PI / 2
  drawn.add(plate, button)
  return {
    drawn,
    panel,
    near: (hips: { x: number; z: number }, arm: number) =>
      Math.hypot(hips.x - panel.button.x, hips.z - panel.button.z) < arm,
    update() {
      button.position.copy(panel.button).z += BUTTON.proud / 2 + (panel.pressed ? TRAVEL : 0)
      button.material.color.set(panel.pressed ? 0x30d030 : 0xd03030)
    },
  }
}
