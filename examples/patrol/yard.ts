import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

/** how far the ground reaches from the middle along x and z, and how thick it is (m) */
const GROUND = { reach: 20, thick: 0.2 }
/** the walls and crates: where the middle of each stands on the ground, and how wide, high and long it is along x, y and z (m) */
const BLOCKS = [
  { at: [0, 0, 9], size: [12, 2.4, 0.3], color: 0x6a5a4a },
  { at: [-6, 0, 5], size: [0.3, 2.4, 8], color: 0x6a5a4a },
  { at: [6, 0, 6], size: [0.3, 2.4, 6], color: 0x6a5a4a },
  { at: [-2.5, 0, 3], size: [1, 1, 1], color: 0x9a7a40 },
  { at: [-1.7, 0, 3.4], size: [0.8, 0.8, 0.8], color: 0x8a6a30 },
  { at: [2.5, 0, 5], size: [1.2, 1.2, 1.2], color: 0x9a7a40 },
  { at: [3, 0, -2], size: [1, 0.8, 2], color: 0x8a6a30 },
] as const

/** a box that stands where it is, which the world has things collide with: from its foot on the ground */
function block([x, y, z]: readonly [number, number, number], [wide, high, long]: readonly [number, number, number], color: number) {
  const solid = new RigidBody({ bodyType: 'static' })
  solid.position.copy(new Vector3(x, y + high / 2, z))
  solid.add(new Mesh(new BoxGeometry(wide, high, long), new MeshStandardMaterial({ color })))
  return solid
}

/** the yard: the ground, walls round a corner of it and a few crates */
export function yard() {
  const ground = block([0, -GROUND.thick, 0], [2 * GROUND.reach, GROUND.thick, 2 * GROUND.reach], 0x3a4a3a)
  return new Group().add(ground, ...BLOCKS.map(({ at, size, color }) => block(at, size, color)))
}
