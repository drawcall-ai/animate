import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

/** a hurdle across the lane: where it stands along z, and how high its bar is (m) */
export type Hurdle = { z: number; height: number }

/** how high the bar of a hurdle is (m) */
export const HEIGHT = 0.76
/** how far along the first hurdle stands from where the runner starts, and how far apart they are (m) */
export const FIRST = 13
export const APART = 8.5
/** how wide a hurdle is, how thick its bar, its posts and its feet are, how far its feet reach toward the runner and past the bar (m) */
export const WIDE = 1.2
const BAR = { high: 0.07, thick: 0.02 }
const POST = 0.03
const FOOT = { high: 0.03, back: 0.6, ahead: 0.05 }
/** how heavy a hurdle is (kg) */
const MASS = 7
/** how far the track reaches out from the lane's middle, before the start and past the last hurdle, and how thick it is (m) */
const GROUND = { wide: 4, before: 6, after: 30, thick: 0.2 }

const paint = (color: number) => new MeshStandardMaterial({ color })

/** the hurdles of the track, two unless said */
export const track = (count = 2): Hurdle[] =>
  Array.from({ length: count }, (_, k) => ({ z: FIRST + k * APART, height: HEIGHT }))

/** a box drawn and felt by the world: where its middle is and how large it is along x, y and z (m) */
function box(at: Vector3, size: Vector3, color: number) {
  const drawn = new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color))
  drawn.position.copy(at)
  return drawn
}

/** a hurdle as the world has it, free to fall over: a bar on two posts, each on a foot along the lane toward the runner */
export function stand({ z, height }: Hurdle) {
  const solid = new RigidBody({ mass: MASS })
  solid.position.set(0, 0, z)
  solid.add(box(new Vector3(0, height - BAR.high / 2, 0), new Vector3(WIDE, BAR.high, BAR.thick), 0xf0f0f0))
  const post = height - BAR.high - FOOT.high
  const long = FOOT.back + FOOT.ahead
  for (const side of [-1, 1]) {
    const x = (side * (WIDE - POST)) / 2
    solid.add(box(new Vector3(x, FOOT.high + post / 2, 0), new Vector3(POST, post, POST), 0x303030))
    solid.add(
      box(new Vector3(x, FOOT.high / 2, (FOOT.ahead - FOOT.back) / 2), new Vector3(POST, FOOT.high, long), 0x303030),
    )
  }
  return solid
}

/** the track the hurdles of a race stand on, its lane marked out */
export function ground(hurdles: Hurdle[]) {
  const last = hurdles.reduce((far, { z }) => Math.max(far, z), 0)
  const long = GROUND.before + last + GROUND.after
  const middle = (last + GROUND.after - GROUND.before) / 2
  const floor = new RigidBody({ bodyType: 'static' })
  floor.add(box(new Vector3(0, -GROUND.thick / 2, middle), new Vector3(2 * GROUND.wide, GROUND.thick, long), 0xa04a32))
  const lines = [-1, 1].map((side) =>
    box(new Vector3((side * WIDE) / 2, 0.001, middle), new Vector3(0.05, 0.002, long), 0xf0f0f0),
  )
  return new Group().add(floor, ...lines)
}
