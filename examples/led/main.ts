import { Body } from 'animate-2d'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'

/** how fast he is led at a walk, and with shift held, at a run (m/s) */
const SPEED = { walk: 1.4, run: 4.5 }
/** how far from the middle of his hips he stays clear of a box (m) */
const GIRTH = 0.3
/** the boxes in his way: where the middle of each is on the ground, how far it reaches from there along x and along z, and how high it is (m) */
const BOXES = [
  { x: 1.5, z: 3, wide: 0.5, long: 0.5, high: 1 },
  { x: -2, z: 5, wide: 1, long: 0.3, high: 0.6 },
  { x: 0, z: -2.5, wide: 3, long: 0.2, high: 1.4 },
]

const held = new Set<string>()
addEventListener('keydown', (event) => held.add(event.code))
addEventListener('keyup', (event) => held.delete(event.code))
const pressed = (...codes: string[]) => Number(codes.some((code) => held.has(code)))
const clamp = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value))

/** where the boxes let the middle of his hips be, that would be at a place: out of each, the shortest way */
function clear({ x, z }: { x: number; z: number }) {
  for (const box of BOXES) {
    const [off, on] = [
      x - clamp(x, box.x - box.wide, box.x + box.wide),
      z - clamp(z, box.z - box.long, box.z + box.long),
    ]
    const far = Math.hypot(off, on)
    if (far >= GIRTH) continue
    // (in it, out by the nearer of its sides along x)
    if (far === 0) x = box.x + Math.sign(x - box.x || 1) * (box.wide + GIRTH)
    else [x, z] = [x + (off / far) * (GIRTH - far), z + (on / far) * (GIRTH - far)]
  }
  return { x, z }
}

let body: Body
/** the way he was last led, which he keeps facing while F is held */
let facing = { x: 0, z: 1 }

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    facing = { x: 0, z: 1 }
    const boxes = BOXES.map((box) => {
      const drawn = new Mesh(
        new BoxGeometry(2 * box.wide, box.high, 2 * box.long),
        new MeshStandardMaterial({ color: 0x607080 }),
      )
      drawn.position.set(box.x, box.high / 2, box.z)
      return drawn
    })
    return new Group().add(man, ...boxes)
  },
  update(delta) {
    // the keys say how he is to be going: right and left along z, up and down along x
    const [x, z] = [
      pressed('ArrowUp', 'KeyW') - pressed('ArrowDown', 'KeyS'),
      pressed('ArrowRight', 'KeyD') - pressed('ArrowLeft', 'KeyA'),
    ]
    const speed = held.has('ShiftLeft') || held.has('ShiftRight') ? SPEED.run : SPEED.walk
    const asked = x || z ? { x: (x * speed) / Math.hypot(x, z), z: (z * speed) / Math.hypot(x, z) } : { x: 0, z: 0 }
    // he is led as the boxes let him go: from where he is, on to where they let him be a moment on
    const from = body.hips.value
    const on = clear({ x: from.x + asked.x * delta, z: from.z + asked.z * delta })
    const going = delta > 0 ? { x: (on.x - from.x) / delta, z: (on.z - from.z) / delta } : asked
    body.go(going)
    if (held.has('KeyF')) body.face(facing)
    else {
      body.face()
      if (going.x || going.z) facing = going
    }
    body.update(delta)
    // and where they have stopped him is told to the body
    const stopped = clear(body.hips.value)
    if (stopped.x !== body.hips.value.x || stopped.z !== body.hips.value.z) body.hips.at(stopped)
  },
  focus: () => body.hips.value.z,
  readout() {
    const { x, z } = body.hips.velocity
    return [`speed     ${Math.hypot(x, z).toFixed(1)} m/s`].join('\n')
  },
})
