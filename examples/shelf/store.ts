import type { Size } from '@drawcall/animate'
import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three'

/** how wide and deep (alike) a box is, how high, and how heavy (m, kg) */
export const BOX = { side: 0.36, high: 0.26, mass: 6 }
/** the shelf unit: where the middle of its front is, how wide, deep and thick a board is, and how thick a post (m) */
export const SHELF = { x: 0, front: 3, wide: 1.1, deep: 0.42, thick: 0.03, post: 0.04 }
/** where the boxes lie on the floor at the start, and how they are turned (m, rad) */
const LYING = [
  { x: -1.3, z: 1.4, turn: 0.3 },
  { x: 1.1, z: 1.1, turn: -0.5 },
  { x: 1.6, z: -0.8, turn: 1.1 },
]

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a box that stands where it is: its middle, and how large it is along x, y and z (m) */
function block(at: Vector3, x: number, y: number, z: number, color: number) {
  const solid = new RigidBody({ bodyType: 'static' })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(x, y, z), paint(color)))
  return solid
}

/**
 * how high the top of each board is, the lowest first: at his knee, his chest, and his eyes, where a box is above his
 * head and still in his reach (m)
 */
export function boards(size: Size) {
  const shoulder = size.stand + size.trunk
  return [size.ankle + size.shin, size.stand + 0.6 * size.trunk, shoulder + 0.4 * size.trunk]
}

/** where the middle of a box lies on a board whose top is so high: just behind its front edge */
export const slot = (top: number) => new Vector3(SHELF.x, top + BOX.high / 2 + 0.003, SHELF.front + BOX.side / 2 + 0.02)

/** whether a place is over the shelf's boards */
export const shelved = (at: Vector3) =>
  Math.abs(at.x - SHELF.x) < SHELF.wide / 2 && at.z > SHELF.front && at.z < SHELF.front + SHELF.deep && at.y > 0.3

/** the floor, and the shelf unit with its boards at the heights given */
export function room(tops: number[]) {
  const floor = block(new Vector3(0, -0.1, 0), 20, 0.2, 20, 0x8a8478)
  const unit = new Group()
  const middle = SHELF.front + SHELF.deep / 2
  const high = Math.max(...tops) + 0.1
  for (const top of tops)
    unit.add(block(new Vector3(SHELF.x, top - SHELF.thick / 2, middle), SHELF.wide, SHELF.thick, SHELF.deep, 0x9a7a50))
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const at = new Vector3(
        SHELF.x + (x * (SHELF.wide + SHELF.post)) / 2,
        high / 2,
        middle + (z * (SHELF.deep - SHELF.post)) / 2,
      )
      unit.add(block(at, SHELF.post, high, SHELF.post, 0x3a5a8a))
    }
  return new Group().add(floor, unit)
}

/** A cardboard box: a body of its own the world moves while it is free, or moved by whoever holds it. */
export class Box {
  readonly mesh = new Mesh(new BoxGeometry(BOX.side, BOX.high, BOX.side), paint(0xc09050))
  private solid?: RigidBody

  constructor(private readonly scene: Object3D) {}

  get free() {
    return this.solid !== undefined
  }

  get place() {
    return this.mesh.getWorldPosition(new Vector3())
  }

  /** it is let go where it is: a body of its own in the world, at rest */
  release() {
    const solid = new RigidBody({ mass: BOX.mass })
    this.mesh.updateWorldMatrix(true, false)
    this.mesh.matrixWorld.decompose(solid.position, solid.quaternion, solid.scale)
    solid.add(this.mesh)
    this.mesh.position.set(0, 0, 0)
    this.mesh.quaternion.identity()
    this.scene.add(solid)
    this.solid = solid
  }

  /** it is taken out of the world where it is, to be moved by whoever holds it */
  take() {
    this.scene.attach(this.mesh)
    this.solid?.removeFromParent()
    this.solid = undefined
  }
}

/** the boxes lying on the floor, free */
export function boxes(scene: Object3D) {
  return LYING.map(({ x, z, turn }) => {
    const box = new Box(scene)
    box.mesh.position.set(x, BOX.high / 2 + 0.002, z)
    box.mesh.rotation.y = turn
    scene.add(box.mesh)
    box.release()
    return box
  })
}
