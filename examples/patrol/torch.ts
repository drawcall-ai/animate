import { grip } from '@drawcall/hand'
import type { Hand } from '@drawcall/hand'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'

/** the torch along +z from the end of its handle at the origin: how long and thick the handle is, how long and wide the head is, how far its beam reaches (m) and how wide it opens (rad) */
const TORCH = { handle: 0.16, grip: 0.021, head: 0.08, lens: 0.04, reach: 14, opens: 0.4 }

/** a torch: a handle and a head, and a spot light in the head shining along +z */
export function torch() {
  const made = new Group()
  const part = (radius: number, length: number, at: number, color: number) => {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 12), new MeshStandardMaterial({ color }))
    mesh.rotation.x = Math.PI / 2
    mesh.position.z = at
    return mesh
  }
  const front = TORCH.handle + TORCH.head
  const light = new SpotLight(0xfff0c0, 80, TORCH.reach, TORCH.opens, 0.4)
  light.position.z = front
  const aim = new Object3D()
  aim.position.z = front + 1
  light.target = aim
  made.add(
    part(TORCH.grip, TORCH.handle, TORCH.handle / 2, 0x202020),
    part(TORCH.lens, TORCH.head, TORCH.handle + TORCH.head / 2, 0x505050),
    light,
    aim,
  )
  return made
}

/** the right hand, at rest, holding the torch by the middle of its handle: how it sits in the hand, and the fingers' pose */
export function gripped(hand: Hand, held: Object3D) {
  return grip(hand, held, { at: new Vector3(0, -1 * TORCH.grip, TORCH.handle / 2), from: new Vector3(0, -1, 0) })
}
