import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

/** how far ahead of where he starts the net is, how high it hangs, and how far it reaches either side (m) */
export const NET = { z: 8, high: 0.914, wide: 5.03 }
/** how far a half of the court is from the net to its baseline, and how far a sideline is from the middle (m) */
export const HALF = { long: 11.89, wide: 4.115, service: 6.4 }
/** where the ball machine's mouth is: a metre in from the far baseline, a metre up (m) */
export const MOUTH = new Vector3(0, 1, NET.z + HALF.long - 1)
/** how much of its speed up a ball keeps off the court */
export const BOUNCE = 0.75
const LINE = 0.05

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a box that stands where it is, which the world has things collide with: its middle and size (m) */
function block(at: Vector3, size: Vector3, color: number, restitution: number) {
  const solid = new RigidBody({ bodyType: 'static', material: { restitution, staticFriction: 0, dynamicFriction: 0 } })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color)))
  return solid
}

/** a line painted on the court, from one place to another */
function line(x0: number, z0: number, x1: number, z1: number) {
  const drawn = new Mesh(new BoxGeometry(Math.abs(x1 - x0) + LINE, 0.002, Math.abs(z1 - z0) + LINE), paint(0xf0f0f0))
  drawn.position.set((x0 + x1) / 2, 0.001, (z0 + z1) / 2)
  return drawn
}

/** The court, its lines, the net across it and the ball machine at the far end: the court and the net are solid to a ball. */
export function court() {
  const floor = block(new Vector3(0, -0.1, NET.z), new Vector3(20, 0.2, 2 * HALF.long + 8), 0x3a7a50, BOUNCE)
  const net = block(new Vector3(0, NET.high / 2, NET.z), new Vector3(2 * NET.wide, NET.high, 0.03), 0xdddddd, 0.1)
  const [near, far, w, s] = [NET.z - HALF.long, NET.z + HALF.long, HALF.wide, HALF.service]
  const lines = [
    line(-w, near, w, near),
    line(-w, far, w, far),
    line(-w, near, -w, far),
    line(w, near, w, far),
    line(-w, NET.z - s, w, NET.z - s),
    line(-w, NET.z + s, w, NET.z + s),
    line(0, NET.z - s, 0, NET.z + s),
  ]
  const posts = [-1, 1].map((side) => {
    const post = new Mesh(new CylinderGeometry(0.04, 0.04, NET.high + 0.1), paint(0x404040))
    post.position.set(side * NET.wide, (NET.high + 0.1) / 2, NET.z)
    return post
  })
  const machine = new Mesh(new BoxGeometry(0.5, 0.7, 0.6), paint(0x2050a0))
  machine.position.set(MOUTH.x, 0.35, MOUTH.z + 0.3)
  const tube = new Mesh(new CylinderGeometry(0.06, 0.06, 0.5).rotateX(Math.PI / 2 - 0.3), paint(0x202020))
  tube.position.set(MOUTH.x, MOUTH.y - 0.1, MOUTH.z + 0.2)
  return new Group().add(floor, net, ...lines, ...posts, machine, tube)
}
