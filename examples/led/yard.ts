import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'

/** how wide the yard is and how far it runs along z from where he starts (m) */
const YARD = { wide: 8, near: 4, far: 24, thick: 0.2 }
/** the flight of stairs: the first step's start along z, how many steps, how deep and how high each is (m) */
const STAIRS = { z: 1.5, steps: 5, deep: 0.3, high: 0.18 }
/** the platform at the top of the stairs, the gap, the second platform and the ramp down from it, along z (m) */
const PLATFORM = { length: 3, gap: 1.5, ramp: 4 }
/** where the low kerb stands after the ramp, and how high and deep it is (m) */
const KERB = { z: 16, high: 0.15, deep: 0.3 }

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a box that stands where it is, which the world has things collide with: its start along z, its length, top height and thickness */
function slab(z: number, length: number, top: number, thick: number, color: number) {
  const solid = new RigidBody({ bodyType: 'static' })
  solid.position.set(0, top - thick / 2, z + length / 2)
  solid.add(new Mesh(new BoxGeometry(2 * YARD.wide, thick, length), paint(color)))
  return solid
}

/** a slab tilted down along +z from the top height `from` at `z` to the ground at `z + length` */
function ramp(z: number, length: number, from: number) {
  const angle = Math.atan2(from, length)
  const thick = YARD.thick
  const solid = slab(z, Math.hypot(length, from), 0, thick, 0x907050)
  solid.rotation.x = angle
  // (the top surface passes through both ends)
  solid.position.set(0, from / 2 - (Math.cos(angle) * thick) / 2, z + length / 2 - (Math.sin(angle) * thick) / 2)
  return solid
}

/** The yard along +z: the ground, stairs up to a platform, a gap, a second platform, a ramp down and a low kerb. */
export function yard() {
  const group = new Group()
  group.add(slab(-YARD.near, YARD.near + YARD.far, 0, YARD.thick, 0x506050))
  for (let k = 1; k <= STAIRS.steps; k++) {
    const top = k * STAIRS.high
    group.add(slab(STAIRS.z + (k - 1) * STAIRS.deep, STAIRS.deep, top, top, 0x708090))
  }
  const top = STAIRS.steps * STAIRS.high
  const first = STAIRS.z + STAIRS.steps * STAIRS.deep
  const second = first + PLATFORM.length + PLATFORM.gap
  group.add(slab(first, PLATFORM.length, top, top, 0x708090))
  group.add(slab(second, PLATFORM.length, top, top, 0x708090))
  group.add(ramp(second + PLATFORM.length, PLATFORM.ramp, top))
  group.add(slab(KERB.z, KERB.deep, KERB.high, KERB.high, 0xa09060))
  return group
}
