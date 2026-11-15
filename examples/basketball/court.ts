import { RigidBody, SphereCollider } from '@drawcall/physics'
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
} from 'three'
import { RADIUS } from './ball'

/** where the middle of the ring is, above the floor and ahead of where he starts, and how wide it is (m) */
export const HOOP = { x: 0, y: 3.05, z: 6, radius: 0.225 }
/** how far the board is behind the middle of the ring, how wide, high and thick it is, and how far its bottom is below the ring (m) */
const BOARD = { behind: 0.375, wide: 1.8, high: 1.05, thick: 0.03, below: 0.15 }
/** how thick the ring's rod is, and how many spheres the world has it as (m) */
const ROD = { radius: 0.01, spheres: 24 }
/** how much of its speed a ball keeps off the ring and the board */
const BOUNCE = 0.6
/** how far the floor reaches from its middle along x and along z, how thick it is, and how wide a line on it is (m) */
const FLOOR = { wide: 12, long: 16, thick: 0.2, line: 0.05 }
const GRAVITY = 9.81

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a box that stands where it is, which the world has things collide with: its middle, and how large it is along x, y and z (m) */
function block(at: Vector3, size: Vector3, color: number) {
  const solid = new RigidBody({ bodyType: 'static', material: { restitution: BOUNCE } })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color)))
  return solid
}

/** a line painted on the floor, from one place on it to another */
function line(from: { x: number; z: number }, to: { x: number; z: number }) {
  const long = Math.hypot(to.x - from.x, to.z - from.z)
  const drawn = new Mesh(new BoxGeometry(FLOOR.line, 0.002, long + FLOOR.line), paint(0xf0f0f0))
  drawn.position.set((from.x + to.x) / 2, 0.001, (from.z + to.z) / 2)
  drawn.rotation.y = Math.atan2(to.x - from.x, to.z - from.z)
  return drawn
}

/** The floor, the lines on it, and the hoop: the ring, which the world has as a ring of small spheres, the board behind it and the post that holds it up. */
export function court() {
  const floor = block(new Vector3(0, -FLOOR.thick / 2, 0), new Vector3(2 * FLOOR.wide, FLOOR.thick, 2 * FLOOR.long), 0xb08850)
  const ring = new RigidBody({ bodyType: 'static', material: { restitution: BOUNCE } })
  ring.position.set(HOOP.x, HOOP.y, HOOP.z)
  const torus = new Mesh(new TorusGeometry(HOOP.radius, ROD.radius), paint(0xd04020))
  torus.rotation.x = Math.PI / 2
  ring.add(torus)
  for (let k = 0; k < ROD.spheres; k++) {
    const turn = (2 * Math.PI * k) / ROD.spheres
    const sphere = new SphereCollider({ radius: ROD.radius })
    sphere.position.set(HOOP.radius * Math.cos(turn), 0, HOOP.radius * Math.sin(turn))
    ring.add(sphere)
  }
  const behind = HOOP.z + BOARD.behind
  const board = block(
    new Vector3(HOOP.x, HOOP.y - BOARD.below + BOARD.high / 2, behind + BOARD.thick / 2),
    new Vector3(BOARD.wide, BOARD.high, BOARD.thick),
    0xe0e0e0,
  )
  const post = new RigidBody({ bodyType: 'static' })
  post.add(new Mesh(new CylinderGeometry(0.08, 0.08, HOOP.y + BOARD.high), paint(0x505050)))
  post.position.set(HOOP.x, (HOOP.y + BOARD.high) / 2, behind + 1)
  // the key under the hoop and the line it is shot from
  const [key, free] = [2.45, behind - 5.8]
  const lines = [
    line({ x: -key, z: free }, { x: key, z: free }),
    line({ x: -key, z: free }, { x: -key, z: behind }),
    line({ x: key, z: free }, { x: key, z: behind }),
    line({ x: -FLOOR.wide, z: behind }, { x: FLOOR.wide, z: behind }),
  ]
  return new Group().add(floor, ring, board, post, ...lines)
}

/** how a ball leaves a place `up` from level (rad), heading for the ring, to come down through its middle (m/s) */
export function arc(from: Vector3, up: number) {
  const way = new Vector3(HOOP.x - from.x, 0, HOOP.z - from.z)
  const [far, rise] = [way.length(), HOOP.y - from.y]
  const speed = Math.sqrt((GRAVITY * far * far) / (2 * Math.cos(up) ** 2 * (far * Math.tan(up) - rise)))
  return way.setLength(speed * Math.cos(up)).setY(speed * Math.sin(up))
}

/*
 * The ball of the jump shot played on its own (story.ts) and by the library's tests, without a physics world: it flies
 * and bounces on its own here, and the game's ball is ./ball.
 */
/** the scripted ball: `velocity` is none while it is in the hand */
export type Flight = { position: Vector3; velocity: Vector3 | null }
export const ball = (): Flight => ({ position: new Vector3(), velocity: null })

/** let go, it flies, and bounces on the floor until it lies still */
export function fly(flight: Flight, dt: number) {
  if (!flight.velocity || flight.velocity.lengthSq() === 0) return
  flight.velocity.y -= GRAVITY * dt
  flight.position.addScaledVector(flight.velocity, dt)
  if (flight.position.y > RADIUS || flight.velocity.y > 0) return
  flight.position.y = RADIUS
  flight.velocity.y = flight.velocity.y < -0.8 ? -0.7 * flight.velocity.y : 0
  flight.velocity.multiplyScalar(1 - 0.5 * dt)
  if (flight.velocity.length() < 0.05) flight.velocity.set(0, 0, 0)
}
