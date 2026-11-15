import { CylinderCollider, RigidBody, SphericalJoint } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'

/** the heavy bag: how thick and long it is, how long the chain it hangs by, and how heavy it is (m, kg) */
export const BAG = { radius: 0.18, length: 1.1, chain: 0.6, mass: 45 }
/** how fast a hanging bag's swing dies away, and its spin (1/s) */
const DAMPING = { swing: 0.25, spin: 1.5 }
/** how large the floor is, each way from the middle (m) */
const FLOOR = 8

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a solid floor, on y = 0 */
function floor() {
  const solid = new RigidBody({ bodyType: 'static' })
  solid.position.y = -0.1
  solid.add(new Mesh(new BoxGeometry(2 * FLOOR, 0.2, 2 * FLOOR), paint(0x8a7a66)))
  return solid
}

/** a heavy bag on its chain, swinging free about a hook so high, its middle hanging at `middle` */
function bag(middle: Vector3) {
  const solid = new RigidBody({ mass: BAG.mass, canSleep: false })
  solid.setLinearDamping(DAMPING.swing).setAngularDamping(DAMPING.spin)
  solid.position.copy(middle)
  solid.add(
    new CylinderCollider({ radius: BAG.radius, height: BAG.length }),
    new Mesh(new CylinderGeometry(BAG.radius, BAG.radius, BAG.length, 24), paint(0x8c2222)),
  )
  const chain = new Mesh(new CylinderGeometry(0.008, 0.008, BAG.chain), paint(0x9098a0))
  chain.position.y = (BAG.length + BAG.chain) / 2
  solid.add(chain)
  const hook = new SphericalJoint({ body0: null, body1: solid })
  hook.position.copy(middle).setY(middle.y + BAG.length / 2 + BAG.chain)
  return { solid, hook }
}

/** the gym: its floor, and the heavy bag hanging with its middle at `middle` */
export function gym(middle: Vector3) {
  const hung = bag(middle)
  return { scene: new Group().add(floor(), hung.solid, hung.hook), bag: hung.solid }
}
