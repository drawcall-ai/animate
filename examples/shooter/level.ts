import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { type Panel, TRAVEL } from './actions'

/**
 * the floor and the boxes on it: where the middle of each is on the ground, how far it reaches from there along x and
 * along z, and how high it is (m). The first box is the wall the panel is on, and the low one is to jump onto
 */
const FLOOR = { x: 0, z: 0, wide: 20, long: 20, high: 0.2 }
const BOXES = [
  { x: 0, z: 6, wide: 3, long: 0.2, high: 2.4 },
  { x: 2.5, z: 2.5, wide: 0.5, long: 0.5, high: 1 },
  { x: -3, z: 3, wide: 0.8, long: 0.8, high: 0.4 },
  { x: -1, z: -4, wide: 0.4, long: 1.5, high: 1.4 },
]
/** the button: its radius, and how far it stands out of the wall (m) */
const BUTTON = { radius: 0.02, proud: 0.015 }

/** a box that stands where it is, which the world has him collide with and stand on */
function box({ x, z, wide, long, high }: (typeof BOXES)[number], color: number) {
  const solid = new RigidBody({ bodyType: 'static' })
  const mesh = new Mesh(new BoxGeometry(2 * wide, high, 2 * long), new MeshStandardMaterial({ color }))
  solid.position.set(x, high / 2, z)
  solid.add(mesh)
  return solid
}

/** The floor's boxes and the wall with its panel: what is drawn, the panel, and whether he is near enough to press its button: within an arm's length of it along the ground. */
export function level() {
  const wall = BOXES[0]
  const panel: Panel = {
    button: new Vector3(1, 1.3, wall.z - wall.long - BUTTON.proud),
    out: new Vector3(0, 0, -1),
    pressed: false,
  }
  // (the floor's top is the ground)
  const floor = box(FLOOR, 0x303030)
  floor.position.y = -FLOOR.high / 2
  const drawn = new Group().add(floor, ...BOXES.map((each) => box(each, 0x607080)))
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
