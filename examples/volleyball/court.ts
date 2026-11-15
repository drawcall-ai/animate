import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { NET } from './ball'

/** how far a half of the court reaches from the net, how far its sides are from the middle, and how wide a line is (m) */
const HALF = { long: 9, wide: 4.5, line: 0.05 }
/** how far the attack line is from the net (m) */
const ATTACK = 3
/** how high the net's mesh hangs under its top edge, and how thick the world has it (m) */
const MESH = { high: 1, thick: 0.06 }
/** how far the floor reaches past the lines (m) */
const RUNOFF = 3
/** how much of its speed the ball keeps off the floor and the net */
const BOUNCE = { floor: 0.7, net: 0.2 }

const paint = (color: number, opacity = 1) => new MeshStandardMaterial({ color, transparent: opacity < 1, opacity })

/** a box that stands where it is, which the world has things collide with: its middle, and its size along x, y and z (m) */
function block(at: Vector3, size: Vector3, color: number, restitution: number, opacity = 1) {
  const solid = new RigidBody({ bodyType: 'static', material: { restitution } })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color, opacity)))
  return solid
}

/** a line painted across the court at `z`, or along it at `x` from the net to the back line */
function line(across: boolean, at: number) {
  const size = across ? new Vector3(2 * HALF.wide, 0.002, HALF.line) : new Vector3(HALF.line, 0.002, 2 * HALF.long)
  const drawn = new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(0xf0f0f0))
  drawn.position.set(across ? 0 : at, 0.001, across ? at : NET.z)
  return drawn
}

/** The floor and its lines, both halves, and the net between them on its two posts. */
export function court() {
  const long = 2 * (HALF.long + RUNOFF)
  const floor = block(
    new Vector3(0, -0.1, NET.z),
    new Vector3(2 * (HALF.wide + RUNOFF), 0.2, long),
    0x3070b0,
    BOUNCE.floor,
  )
  const net = block(
    new Vector3(0, NET.y - MESH.high / 2, NET.z),
    new Vector3(2 * HALF.wide + 1, MESH.high, MESH.thick),
    0xf0f0f0,
    BOUNCE.net,
    0.5,
  )
  const posts = [-1, 1].map((side) => {
    const post = new Mesh(new CylinderGeometry(0.04, 0.04, NET.y), paint(0x505050))
    post.position.set(side * (HALF.wide + 0.5), NET.y / 2, NET.z)
    return post
  })
  const lines = [
    line(true, NET.z - HALF.long),
    line(true, NET.z - ATTACK),
    line(true, NET.z),
    line(true, NET.z + ATTACK),
    line(true, NET.z + HALF.long),
    line(false, -HALF.wide),
    line(false, HALF.wide),
  ]
  return new Group().add(floor, net, ...posts, ...lines)
}
