import { Body, type Story } from '@drawcall/animate'
import { drawGait, drawPlan, Pen, shown } from '@drawcall/debug'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { RUNS, type Runner } from './runs'
import { Walker } from './walker'

/**
 * Plain motions asked of a body in a few words each, to see that he does them: `?ask=` one of the names below. A jump
 * to the side and back, a keeper's dive low to the side, a low hop on, a ladder climbed foot and hand in turn, and a
 * step made in a given time.
 */
const ASKS: Record<string, (body: Body, scene: Group) => Story> = {
  *side(body) {
    const { stand } = body.size
    yield* body.jump({ x: 1.2, y: stand + 0.3, z: 0 })
    yield* body.until(body.time + 0.6)
    yield* body.jump({ x: 0.4, y: stand + 0.25, z: -0.8 })
  },
  *dive(body, scene) {
    const ball = new Mesh(new CylinderGeometry(0.11, 0.11, 0.01, 16), new MeshStandardMaterial({ color: 0xffffff }))
    ball.rotation.x = Math.PI / 2
    ball.position.set(1.7, 0.6, 0.3)
    scene.add(ball)
    yield* body.until(0.5)
    const dive = body.jump({ x: 1.4, y: 0.6, z: 0.1 })
    yield
    void body.hand.left.by(body.highest(), { x: 1.75, y: 0.75, z: 0.3 })
    void body.hand.right.by(body.highest(), { x: 1.75, y: 0.5, z: 0.3 })
    yield* dive
  },
  *hop(body) {
    for (let k = 0; k < 3; k++) yield* body.jump({ x: 0, y: body.size.stand - 0.1, z: 0.5 * (k + 1) })
  },
  *ladder(body, scene) {
    const { ankle } = body.size
    // a ladder leaning at 75°: its rungs 0.28 m apart
    const wood = new MeshStandardMaterial({ color: 0xa07040 })
    const rungs = Array.from({ length: 9 }, (_, k) => {
      const rung = new Mesh(new CylinderGeometry(0.02, 0.02, 0.45), wood)
      rung.rotation.z = Math.PI / 2
      rung.position.set(0, 0.28 * (k + 1), 0.4 + 0.075 * (k + 1))
      scene.add(rung)
      return rung
    })
    for (const x of [-0.24, 0.24]) {
      const rail = new Mesh(new BoxGeometry(0.03, 2.9, 0.05), wood)
      rail.position.set(x, 1.4, 0.4 + 0.375)
      rail.rotation.x = 0.26
      scene.add(rail)
    }
    scene.updateMatrixWorld(true)
    const at = (side: 'left' | 'right', x: number, y: number) => ({ x: side === 'left' ? x : -x, y, z: 0 })
    const grip = (k: number, side: 'left' | 'right') => body.hand[side].to(at(side, 0.16, 0.02), { on: rungs[k] })
    void grip(3, 'right')
    yield* grip(4, 'left')
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? 'right' : 'left'
      yield* body.foot[side].to(at(side, 0.1, ankle + 0.02), { on: rungs[k] })
      yield* grip(k + 5, side)
    }
  },
  *step(body) {
    yield* body.until(0.5)
    yield* body.foot.left.to(body.ground('left', 0.4), { seconds: 0.3 })
    yield* body.foot.right.to(body.ground('right', 0.4), { seconds: 1.2 })
  },
}

const asked = new URLSearchParams(location.search).get('ask') ?? 'side'
const ask = ASKS[asked] ?? RUNS[asked]
if (!ask) throw new Error(`there is no ask ${asked}: ${[...Object.keys(ASKS), ...Object.keys(RUNS)].join(', ')}`)
/** `?gait=frames` has the frame gait do it in place of the body's own */
const frames = new URLSearchParams(location.search).get('gait') === 'frames'
let body: Body | Walker
const pen = new Pen()
const layers = shown(location.search)
const name = document.getElementById('name')
if (name) name.textContent = asked

run({
  begin() {
    const man = mannequin()
    const scene = new Group().add(man)
    body = frames ? new Walker(man) : new Body(man)
    scene.add(pen)
    if (asked === 'box') {
      const box = new Mesh(new BoxGeometry(0.6, 0.3, 0.4), new MeshStandardMaterial({ color: 0x806040 }))
      box.position.set(0, 0.15, 0.45)
      scene.add(box)
    }
    body.play((ask as (body: Runner, scene: Group) => Story)(body, scene))
    return scene
  },
  update: (delta) => {
    body.update(delta)
    // (the frame gait draws its own layers: `?debug=gait,plan`)
    if (!(body instanceof Walker)) return
    pen.begin()
    if (layers.has('gait')) drawGait(pen, body.gait.intent())
    if (layers.has('plan')) drawPlan(pen, [body.gait.hips, body.gait.feet.left, body.gait.feet.right].map((channel) => channel.intent()))
    pen.show()
  },
  focus: () => body.hips.value.z,
  readout: () => `${asked}  t ${body.time.toFixed(2)} s  hips ${body.hips.value.toArray().map((v) => v.toFixed(2)).join(' ')}`,
})
