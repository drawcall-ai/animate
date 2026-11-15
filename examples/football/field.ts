import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

/** where the middle of the goal line is, ahead of where he starts, and how wide and high the goal is inside its posts (m) */
export const GOAL = { x: 0, z: 11, wide: 7.32, high: 2.44 }
/** how thick a post and the bar are, and how far back the net goes (m) */
const FRAME = { thick: 0.12, deep: 1.8 }
/** how far the grass reaches from its middle along x and along z, how thick it is, and how wide a line on it is (m) */
const GRASS = { wide: 20, long: 24, thick: 0.2, line: 0.1 }

const paint = (color: number, opacity = 1) =>
  new MeshStandardMaterial({ color, transparent: opacity < 1, opacity })

/** a box that stands where it is, which the world has things collide with: its middle, how large it is, and how much of its speed a ball keeps off it */
function block(at: Vector3, size: Vector3, color: number, bounce: number, opacity = 1) {
  const solid = new RigidBody({ bodyType: 'static', material: { restitution: bounce } })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color, opacity)))
  return solid
}

/** a line painted on the grass, its middle and how long it is along x and along z (m) */
function line(x: number, z: number, along: number, across: number) {
  const drawn = new Mesh(new BoxGeometry(along, 0.002, across), paint(0xf0f0f0))
  drawn.position.set(x, 0.001, z)
  return drawn
}

/** The grass, its lines, and the goal: the posts and the bar, and a net behind them that takes the ball's speed. */
export function field() {
  const { x, z, wide, high } = GOAL
  const { thick, deep } = FRAME
  const grass = block(new Vector3(0, -GRASS.thick / 2, 0), new Vector3(2 * GRASS.wide, GRASS.thick, 2 * GRASS.long), 0x3f8f3a, 0.5)
  const half = wide / 2 + thick / 2
  const post = (side: number) =>
    block(new Vector3(x + side * half, high / 2, z), new Vector3(thick, high, thick), 0xffffff, 0.6)
  const bar = block(new Vector3(x, high + thick / 2, z), new Vector3(wide + 2 * thick, thick, thick), 0xffffff, 0.6)
  const net = [
    block(new Vector3(x, high / 2, z + deep), new Vector3(wide, high, 0.02), 0xdddddd, 0.05, 0.35),
    block(new Vector3(x, high, z + deep / 2), new Vector3(wide, 0.02, deep), 0xdddddd, 0.05, 0.35),
    block(new Vector3(x - wide / 2, high / 2, z + deep / 2), new Vector3(0.1, high, deep), 0xdddddd, 0.05, 0.35),
    block(new Vector3(x + wide / 2, high / 2, z + deep / 2), new Vector3(0.1, high, deep), 0xdddddd, 0.05, 0.35),
  ]
  // the goal line, the six-yard box and the penalty spot
  const box = 5.5
  const lines = [
    line(x, z, 2 * GRASS.wide, GRASS.line),
    line(x, z - box, wide + 2 * box, GRASS.line),
    line(x - wide / 2 - box, z - box / 2, GRASS.line, box),
    line(x + wide / 2 + box, z - box / 2, GRASS.line, box),
    line(x, z - 11, 0.22, 0.22),
  ]
  return new Group().add(grass, post(-1), post(1), bar, ...net, ...lines)
}
