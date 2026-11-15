import type { Size } from '@drawcall/animate'
import { RigidBody } from '@drawcall/physics'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { PAD } from './target'

/** how long the piste is, how wide, and how far the floor reaches round it (m) */
const PISTE = { long: 14, wide: 1.8, floor: 30 }
/** how far ahead of where he starts the dummy's target is (m) */
export const DUMMY = 2.85
/** how far the point may be from the pad's face and still be on it (m) */
const TOUCH = 0.04

const paint = (color: number) => new MeshStandardMaterial({ color })

/** a box that stands where it is, which the world has him collide with: its middle, and how large it is (m) */
function block(at: Vector3, size: Vector3, color: number) {
  const solid = new RigidBody({ bodyType: 'static' })
  solid.position.copy(at)
  solid.add(new Mesh(new BoxGeometry(size.x, size.y, size.z), paint(color)))
  return solid
}

/** A target dummy on a piste along z: the middle of the pad on its chest, whose face looks back along -z toward him, at his chest's height. */
export class Dummy {
  readonly at: Vector3
  readonly scene: Group

  constructor(size: Size) {
    this.at = new Vector3(0, size.stand + 0.5 * size.trunk, DUMMY)
    const { at } = this
    const torso = new Vector3(2.4 * size.shoulder, 1.1 * size.trunk, 1.2 * size.shoulder)
    const behind = at.z + torso.z / 2 + PAD.thick / 2
    const body = block(new Vector3(0, at.y, behind), torso, 0xe8e4d8)
    const post = new Mesh(new CylinderGeometry(0.04, 0.04, at.y), paint(0x707880))
    post.position.set(0, at.y / 2, behind)
    const pad = new Mesh(new CylinderGeometry(PAD.radius, PAD.radius, PAD.thick, 32), paint(0xa03030))
    pad.rotation.x = Math.PI / 2
    pad.position.set(0, at.y, at.z + PAD.thick / 2)
    const piste = block(new Vector3(0, -0.05, 0), new Vector3(PISTE.wide, 0.1, PISTE.long), 0x5a6e8c)
    const floor = block(new Vector3(0, -0.15, 0), new Vector3(PISTE.floor, 0.1, PISTE.floor), 0x3a3a3a)
    this.scene = new Group().add(floor, piste, body, post, pad)
  }

  /** whether a point is on the pad */
  hit(point: Vector3) {
    const off = Math.hypot(point.x - this.at.x, point.y - this.at.y)
    const into = point.z - this.at.z
    return off <= PAD.radius && into >= -TOUCH && into <= PAD.thick
  }
}
