import { Body } from 'animate-2d'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { lunge } from './lunge'
import { FOIL, PAD, type Target, targetAt, fence } from './target'

// the pad on its post, and the foil: a thin rod from where it is held to its point
const pad = new Mesh(
  new CylinderGeometry(PAD.radius, PAD.radius, PAD.thick),
  new MeshStandardMaterial({ color: 0xa03030 }),
)
pad.rotation.x = Math.PI / 2
const post = new Mesh(new CylinderGeometry(0.03, 0.03, PAD.middle), new MeshStandardMaterial({ color: 0x808890 }))
const blade = new Mesh(new CylinderGeometry(0.006, 0.006, FOIL), new MeshStandardMaterial({ color: 0xd0d4d8 }))
blade.geometry.rotateX(Math.PI / 2)
blade.geometry.translate(0, 0, FOIL / 2)
let body: Body
let target: Target

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    target = targetAt(2.85)
    pad.position.set(target.at.x, target.at.y, target.at.z + PAD.thick / 2)
    post.position.set(target.at.x, PAD.middle / 2, target.at.z + PAD.thick + 0.03)
    body.play(lunge(body, target))
    body.hand.right.grip.add(blade)
    return new Group().add(man, pad, post)
  },
  update(delta) {
    body.update(delta)
    blade.updateWorldMatrix(true, false)
    fence(target, blade.localToWorld(new Vector3(0, 0, FOIL)))
  },
  focus: () => body.hips.value.z,
  readout() {
    return [`touches   ${target.touches}`, `story     ${body.playing ? 'playing' : 'over'}`].join('\n')
  },
})
