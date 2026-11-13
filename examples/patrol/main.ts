import { Body } from 'animate-2d'
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { CORNERS, patrol } from './walk'

const post = new CylinderGeometry(0.04, 0.04, 0.02)
const paint = new MeshStandardMaterial({ color: 0xffd060 })
let body: Body

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    body.play(patrol(body))
    const marks = CORNERS.map(({ x, z }) => {
      const mark = new Mesh(post, paint)
      mark.position.set(x, 0.01, z)
      return mark
    })
    return new Group().add(man, ...marks)
  },
  update(delta) {
    body.update(delta)
  },
  focus: () => 0.9,
  readout() {
    const { x, z } = body.hips.value
    return [`hips      ${x.toFixed(2)}, ${z.toFixed(2)}`, `story     ${body.playing ? 'playing' : 'over'}`].join('\n')
  },
})
