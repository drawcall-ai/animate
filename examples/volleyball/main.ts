import { Body } from 'animate-2d'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { type Ball, NET, RADIUS, ball, fly } from './ball'
import { spike } from './spike'

const ballMesh = new Mesh(new SphereGeometry(RADIUS), new MeshStandardMaterial({ color: 0xf0e060 }))
// the net, seen edge-on: a metre of it under its top edge
const net = new Mesh(
  new BoxGeometry(3, 1, 0.02),
  new MeshStandardMaterial({ color: 0xe0e0e0, transparent: true, opacity: 0.5 }),
)
net.position.set(0, NET.y - 0.5, NET.z)
let body: Body
let hit: Ball
let left: { speed: number; high: number } | undefined
/** how far over the top of the net the ball went (m) */
let over: number | undefined

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    hit = ball()
    left = undefined
    over = undefined
    body.play(spike(body, hit))
    return new Group().add(man, ballMesh, net)
  },
  update(delta) {
    const before = hit.position.z < NET.z
    body.update(delta)
    fly(hit, delta)
    if (hit.velocity && !left) left = { speed: hit.velocity.length(), high: hit.position.y }
    if (before && hit.position.z >= NET.z) over ??= hit.position.y - RADIUS - NET.y
    ballMesh.position.copy(hit.position)
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `hit    ${left ? `${left.speed.toFixed(1)} m/s, ${left.high.toFixed(2)} m high` : '…'}`,
      `net    ${over === undefined ? '…' : `${Math.abs(over).toFixed(2)} m ${over < 0 ? 'under' : 'over'} the top`}`,
      `story  ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
