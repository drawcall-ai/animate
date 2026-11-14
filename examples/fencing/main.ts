import { Body } from '@drawcall/animate'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { carry } from '../carry'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { foil, GRIP } from './foil'
import { lunge } from './lunge'
import { FOIL, PAD, type Target, targetAt, fence } from './target'

// the pad on its post, and the foil
const pad = new Mesh(
  new CylinderGeometry(PAD.radius, PAD.radius, PAD.thick),
  new MeshStandardMaterial({ color: 0xa03030 }),
)
pad.rotation.x = Math.PI / 2
const post = new Mesh(new CylinderGeometry(0.03, 0.03, PAD.middle), new MeshStandardMaterial({ color: 0x808890 }))
const sword = foil()
let body: Body
let target: Target

run({
  begin() {
    const man = mannequin()
    const held = carry(man, 'right', sword, GRIP)
    body = new Body(man)
    target = targetAt(2.85)
    pad.position.set(target.at.x, target.at.y, target.at.z + PAD.thick / 2)
    post.position.set(target.at.x, PAD.middle / 2, target.at.z + PAD.thick + 0.03)
    body.play(lunge(body, target, held))
    return new Group().add(man, pad, post)
  },
  update(delta) {
    body.update(delta)
    sword.updateWorldMatrix(true, false)
    fence(target, sword.localToWorld(new Vector3(0, 0, FOIL)))
  },
  focus: () => body.hips.value.z,
  readout() {
    return [`touches   ${target.touches}`, `story     ${body.playing ? 'playing' : 'over'}`].join('\n')
  },
})
