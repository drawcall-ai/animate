import { CylinderCollider, RigidBody, SphereCollider } from '@drawcall/physics'
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { LANE, LINE, RADIUS, release } from './lane'

/** how heavy a ball and a pin are (kg), and how high and thick a pin is at its belly (m) */
const MASS = { ball: 6.5, pin: 1.5 }
const PIN = { high: 0.38, radius: 0.06 }
/** how far apart the pins stand (m) */
const SPACING = 0.305
/** how thick the lane's boards are over the floor (m) */
const BOARDS = 0.01
/** where the ball return is beside the approach, how high the middle of a ball resting on it is (a little below a man's waist), and how far apart they rest (m) */
export const RACK = { x: 1.1, y: 0.72, z: 1.2, apart: 0.26 }
/** the boards' slippery oil, and how much a pin or a ball keeps of its speed off another */
const OIL = { dynamicFriction: 0.1, staticFriction: 0.1, restitution: 0.3 }
/** a pin counts as down once it leans this far from upright (rad) */
const FALLEN = 0.5
/** the lane runs along +z down the middle of where a right hand lets a ball go, from the foul line to the pins */
const MIDDLE = release(0).x
const END = LINE + LANE.length
const COLORS = [0x3060c0, 0xc03040, 0x30a060]

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a box that stands where it is: its middle and size (m) */
function block(at: Vector3, size: Vector3, color: number) {
  const solid = new RigidBody({ bodyType: 'static', material: OIL })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color)))
  return solid
}

/** the floor, the lane's boards and foul line, the cushion behind the pins, and the ball return's shelf */
export function alley() {
  const floor = block(new Vector3(0, -0.1, END / 2), new Vector3(12, 0.2, END + 12), 0x404048)
  const boards = block(new Vector3(MIDDLE, BOARDS / 2, END / 2), new Vector3(LANE.width, BOARDS, END), 0xc09050)
  const line = new Mesh(new BoxGeometry(LANE.width, 0.012, 0.03), paint(0x202020))
  line.position.set(MIDDLE, 0.006, LINE)
  const cushion = block(new Vector3(MIDDLE, 0.4, END + 1), new Vector3(3, 0.8, 0.2), 0x202020)
  const shelf = block(
    new Vector3(RACK.x, (RACK.y - RADIUS) / 2, RACK.z),
    new Vector3(0.3, RACK.y - RADIUS, 1),
    0x606070,
  )
  return new Group().add(floor, boards, line, cushion, shelf)
}

/** the balls, drawn */
export const balls = () => COLORS.map((color) => new Mesh(new SphereGeometry(RADIUS, 24, 16), paint(color)))

/** where a ball rests on the return */
export const home = (k: number) => new Vector3(RACK.x, RACK.y, RACK.z + (k - 1) * RACK.apart)

/** a ball let go where it is, moving so: a body of its own the world moves */
export function roll(mesh: Object3D, velocity: Vector3) {
  const solid = new RigidBody({ mass: MASS.ball, velocity: { linear: velocity.toArray() }, material: OIL })
  solid.add(new SphereCollider({ radius: RADIUS }))
  mesh.getWorldPosition(solid.position)
  mesh.position.set(0, 0, 0)
  mesh.quaternion.identity()
  mesh.scale.setScalar(1)
  solid.add(mesh)
  return solid
}

/** whether a ball let go is done: in the pit beyond the pins, or come to rest */
export const done = (solid: RigidBody) => solid.position.z > END + 0.3 || solid.getVelocity().linear.length() < 0.05

/** The ten pins in their triangle at the end of the lane, the head pin nearest: set up anew, and counted as they fall. */
export class Pins {
  readonly group = new Group()
  private standing: RigidBody[] = []

  constructor() {
    this.set()
  }

  /** where the head pin stands, for a camera */
  get head() {
    return new Vector3(MIDDLE, PIN.high / 2, END - 3 * SPACING * Math.cos(Math.PI / 6))
  }

  /** they are taken away and stood up again */
  set() {
    for (const pin of this.standing) pin.removeFromParent()
    const { head } = this
    this.standing = []
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k <= row; k++) {
        const pin = new RigidBody({ mass: MASS.pin, material: { restitution: 0.1 } })
        pin.add(new CylinderCollider({ radius: PIN.radius, height: PIN.high }))
        pin.add(new Mesh(new CylinderGeometry(0.025, PIN.radius, PIN.high, 16), paint(0xf0f0f0)))
        pin.position.set(
          MIDDLE + (k - row / 2) * SPACING,
          head.y + BOARDS,
          head.z + row * SPACING * Math.cos(Math.PI / 6),
        )
        this.standing.push(pin)
      }
    }
    this.group.add(...this.standing)
  }

  /** how many have fallen */
  get down() {
    const up = new Vector3()
    return this.standing.filter((pin) => up.set(0, 1, 0).applyQuaternion(pin.quaternion).y < Math.cos(FALLEN)).length
  }
}
