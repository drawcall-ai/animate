import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Start } from '../play'
import { model } from '../play'
import { served } from '../served'
import { Gladiator, POST } from './gladiator'
import { rig } from './skeleton'

/** how far the sand reaches from the middle along x and z, and how thick it is (m) */
const SAND = { wide: 12, thick: 0.2 }

/** something that stands where it is, which the world has things collide with: its middle, and how it is drawn */
function solid(at: Vector3, mesh: Mesh) {
  const body = new RigidBody({ bodyType: 'static' })
  body.position.copy(at)
  body.add(mesh)
  return body
}

/** The sand of the arena and the wooden post on it. */
function arena() {
  const sand = new Mesh(
    new BoxGeometry(2 * SAND.wide, SAND.thick, 2 * SAND.wide),
    new MeshStandardMaterial({ color: 0xc8b07a }),
  )
  const post = new Mesh(
    new CylinderGeometry(POST.radius, POST.radius, POST.high),
    new MeshStandardMaterial({ color: 0x7a5a38 }),
  )
  return new Group().add(
    solid(new Vector3(0, -SAND.thick / 2, 0), sand),
    solid(new Vector3(POST.x, POST.high / 2, POST.z), post),
  )
}

const load = async (url: string) => (await new GLTFLoader().loadAsync(url)).scene

/** the arena, and the gladiator in it with his sword and shield, the post ahead of him */
export const start: Start = async (scene, world) => {
  scene.add(arena())
  const [body, gladius, scutum] = await Promise.all([
    model(rig()),
    load(served('/models/gladius.glb')),
    load(served('/models/scutum.glb')),
  ])
  return new Gladiator(body, world, scene, { gladius, scutum })
}
