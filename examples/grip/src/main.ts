// A grip is stated by three things, and each has its own control here:
//   the thing's transformation   (move / turn the thing)
//   the grip point               (red: where on the thing, in the thing's frame)
//   the grip direction           (blue: the side the hand comes from, in the thing's frame)
// `grip(hand, thing, { at, from, using })` finds the placement and the fingers' pose; `hold` puts the hand there.

import { block, flesh, handle, stage } from '@drawcall/example-stage'
import { type Element, type Grip, Hand, grip, hold } from '@drawcall/grab'
import { ArrowHelper, Group, Mesh, MeshBasicMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'
import { createHand } from './rig'
import { THINGS } from './things'

const el = (id: string) => document.getElementById(id)!
const GRIPS: Record<string, readonly Element[] | undefined> = {
  'Whole hand': undefined,
  'Pinch (thumb, index, middle)': ['thumb', 'index', 'middle'],
  'Fingertip (index)': ['index'],
}

const bone = createHand()
flesh(bone, 0.008)
bone.add(block([0.2, 0.045, 0.055], [0.1, 0, 0])) // a stub of forearm
const hand = new Hand(bone, 'right')

const spot = new Group() // the thing's transformation; the grip point and direction live in its frame
spot.position.set(0, 1.1, 0)
const thing = new Group() // the meshes of whichever thing is chosen: what the hand grips
const seen = (mesh: Mesh) => { // drawn over the thing, so a point inside it can still be seen and picked
  Object.assign(mesh.material, { depthTest: false })
  mesh.renderOrder = 10
  return mesh
}
const at = seen(handle(0xe5484d, 0.007)), from = seen(handle(0x3e63dd, 0.01))
from.position.set(-0.16, 0.05, 0.1)
const arrow = new ArrowHelper(new Vector3(1, 0, 0), from.position, 0.1, 0x3e63dd, 0.03, 0.015)
spot.add(thing, at, from, arrow)
const dots = Array.from({ length: 6 }, () => new Mesh(new SphereGeometry(0.004, 8, 6), new MeshBasicMaterial({ color: 0x4cc38a })))
let using: readonly Element[] | undefined, stale = true, found: Grip | undefined, stated = ''

const { scene, camera, orbit, gizmo } = stage(() => {
  const way = at.position.clone().sub(from.position)
  arrow.position.copy(from.position)
  arrow.setDirection(way.clone().normalize())
  arrow.setLength(way.length(), 0.03, 0.015)
  // the grip is found again whenever its statement or the thing has changed
  const now = [spot.position, spot.quaternion, at.position, from.position].map(v => v.toArray().map(x => x.toFixed(4))).join()
  if (now !== stated) { stated = now; stale = true }
  if (!stale || way.length() < 1e-4) return
  stale = false
  const t0 = performance.now()
  found = grip(hand, thing, { at: at.position.clone(), from: way.clone().negate(), using })
  hold(hand, thing, found) // the thing stays where it is: the hand goes onto it
  dots.forEach((dot, i) => {
    const contact = Object.values(found!.contacts)[i]
    dot.visible = contact.gap < 0.002
    dot.position.copy(thing.localToWorld(contact.at.clone()))
  })
  const touching = Object.entries(found.contacts).filter(([, c]) => c.gap < 0.002).map(([e]) => e)
  el('hud').textContent =
    `grip found in ${(performance.now() - t0).toFixed(0)} ms\n` +
    `${found.fault ? `${(1000 * found.fault).toFixed(1)} mm from holding (the nearest grip it can make)` : 'holds'}\n` +
    `touching: ${touching.join(' ') || 'nothing'}`
})
camera.position.set(-0.45, 1.4, 0.75)
orbit.target.set(0, 1.1, 0)
scene.add(bone, spot, ...dots)

const control = gizmo()
const MODES: [string, Object3D, 'translate' | 'rotate'][] = [
  ['Move thing', spot, 'translate'],
  ['Turn thing', spot, 'rotate'],
  ['Grip point', at, 'translate'],
  ['Grip direction', from, 'translate'],
]
MODES.forEach(([name, object, mode], i) => {
  const button = document.createElement('button')
  button.textContent = name
  button.onclick = () => {
    control.attach(object)
    control.setMode(mode)
    document.querySelectorAll('#buttons button').forEach((b, k) => b.classList.toggle('on', k === i))
  }
  el('buttons').append(button)
  if (i === 3) button.click()
})
const select = (options: string[], pick: (name: string) => void) => {
  const box = document.createElement('select')
  for (const name of options) box.append(new Option(name))
  box.onchange = () => pick(box.value)
  el('buttons').append(box)
  pick(options[0])
}
select(Object.keys(THINGS), name => { thing.clear(); thing.add(THINGS[name]()); stale = true })
select(Object.keys(GRIPS), name => { using = GRIPS[name]; stale = true })
el('hint').textContent = 'A grip is stated by a point on the thing (red) and the side the hand comes from (blue arrow), both in the thing\'s own frame, so they move with it. Pick what the gizmo moves with the buttons; change the thing or which fingers take part with the menus.'
