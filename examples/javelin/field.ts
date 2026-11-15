import type { Statement } from '@drawcall/hand'
import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'

/** how far its ends are from where it is held (m) */
export const LENGTH = { ahead: 1.05, behind: 1.55 }
/** how thick its shaft is: its radius (m) */
export const THICK = 0.012
/** the palm under the shaft where it is held, the fingers round it */
export const GRIP: Statement = { at: new Vector3(0, -THICK, 0), from: new Vector3(0, -1, 0) }

/** how wide the runway is, where it starts and where its throwing line is, along z (m) */
export const RUNWAY = { wide: 4, from: -2, line: 30 }
/** how wide and long the grass is, along x and along z from where the runway starts, and how thick (m) */
const GRASS = { wide: 60, long: 120, thick: 1 }
/** the rack on his right: how far out from the runway's middle its javelins lie, how far apart, and where their grips are along z (m), and how far up from level they point (rad) */
const RACK = { out: 1.4, apart: 0.4, at: 1.2, count: 3, up: 0.25 }

const paint = (color: number) => new MeshStandardMaterial({ color })

/** its shaft, laid along z from where it is held: a cylinder stands along y */
export function shaft() {
  const drawn = new Mesh(
    new CylinderGeometry(THICK, THICK, LENGTH.ahead + LENGTH.behind),
    new MeshStandardMaterial({ color: 0xffd060 }),
  )
  drawn.geometry.rotateX(Math.PI / 2)
  drawn.geometry.translate(0, 0, (LENGTH.ahead - LENGTH.behind) / 2)
  return drawn
}

/** a box that stands where it is, which the world has things collide with: its middle, and how large it is (m) */
function block(at: Vector3, size: Vector3, color: number) {
  const solid = new RigidBody({ bodyType: 'static' })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color)))
  return solid
}

/**
 * The grass with the runway and its throwing line along +z, and the rack on the runway's right where its javelins lie
 * pointing down it, their grips `high` above the ground: and how each lies in the rack, its grip and the way it points.
 */
export function field(high: number) {
  const { up } = RACK
  const { wide, long, thick } = GRASS
  const grass = block(new Vector3(0, -thick / 2, RUNWAY.from + long / 2 - 10), new Vector3(wide, thick, long), 0x4a7a3a)
  const length = RUNWAY.line - RUNWAY.from
  const runway = new Mesh(new BoxGeometry(RUNWAY.wide, 0.004, length), paint(0xa04a32))
  runway.position.set(0, 0.002, RUNWAY.from + length / 2)
  const line = new Mesh(new BoxGeometry(RUNWAY.wide, 0.006, 0.07), paint(0xf0f0f0))
  line.position.set(0, 0.003, RUNWAY.line)
  const rack = Array.from({ length: RACK.count }, (_, k) => {
    const place = new Object3D()
    place.position.set(-RACK.out - k * RACK.apart, high, RACK.at)
    place.rotation.x = -up
    return place
  })
  const span = (RACK.count + 1) * RACK.apart
  const middle = -RACK.out - ((RACK.count - 1) * RACK.apart) / 2
  // a bar under each end, on a post at each of its ends (drawn only: he stands in among them to take one)
  const bars = [-0.8, 0.4].flatMap((along) => {
    const [y, z] = [high + along * Math.tan(up) - THICK - 0.02, RACK.at + along]
    const bar = new Mesh(new BoxGeometry(span, 0.04, 0.04), paint(0x707070))
    bar.position.set(middle, y, z)
    const posts = [-span / 2, span / 2].map((x) => {
      const post = new Mesh(new BoxGeometry(0.04, y, 0.04), paint(0x707070))
      post.position.set(middle + x, y / 2, z)
      return post
    })
    return [bar, ...posts]
  })
  return { drawn: new Group().add(grass, runway, line, ...bars), rack }
}
