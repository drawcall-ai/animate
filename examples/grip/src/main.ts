// A grip is stated by four things, and each has its own control here:
//   the thing's transformation   (move / turn the thing)
//   the grip point               (red: where on the thing, in the thing's frame)
//   the grip direction           (blue: the side the hand comes from, in the thing's frame)
//   the thumb's side             (green: the side of the thing the thumb goes to; with the direction, how the hand is turned)
// `grip(hand, thing, { at, from, thumb, using })` finds where the hand bone goes on the thing and the fingers' pose there.
// That is fixed for as long as the hand holds the thing, so the hand hangs from the thing at that place: moving or
// turning the thing carries the hand along unchanged, and only a new statement makes a new grip.

import { block, flesh, handle, stage } from '@drawcall/example-stage'
import { type Element, Hand, grip } from '@drawcall/grab'
import { ArrowHelper, Group, Mesh, MeshBasicMaterial, type Object3D, SphereGeometry, Vector3 } from 'three'
import { createHand, FLESH } from './rig'
import { THINGS } from './things'

const el = (id: string) => document.getElementById(id)!
const GRIPS: Record<string, readonly Element[] | undefined> = {
  'Whole hand': undefined,
  'Pinch (thumb, index, middle)': ['thumb', 'index', 'middle'],
  'Fingertip (index)': ['index'],
}

const bone = createHand()
flesh(bone, FLESH)
bone.add(block([0.2, 0.045, 0.055], [0.1, 0, 0])) // a stub of forearm
const hand = new Hand(bone, 'right')

const spot = new Group() // the thing's transformation; the grip point and direction live in its frame
spot.position.set(0, 1.1, 0)
const thing = new Group() // the meshes of whichever thing is chosen: what the hand grips
const seat = new Group() // where the hand bone hangs on the thing: the grip's place
seat.add(bone)
const seen = (mesh: Mesh) => { // drawn over the thing, so a point inside it can still be seen and picked
  Object.assign(mesh.material, { depthTest: false })
  mesh.renderOrder = 10
  return mesh
}
const at = seen(handle(0xe5484d, 0.007)), from = seen(handle(0x3e63dd, 0.01)), thumb = seen(handle(0x30a46c, 0.01))
from.position.set(-0.16, 0.05, 0.1)
thumb.position.set(0, 0.1, 0)
const arrow = new ArrowHelper(new Vector3(1, 0, 0), from.position, 0.1, 0x3e63dd, 0.03, 0.015)
const thumbArrow = new ArrowHelper(new Vector3(0, 1, 0), at.position, 0.1, 0x30a46c, 0.02, 0.01)
const dots = Array.from({ length: 6 }, () => new Mesh(new SphereGeometry(0.004, 8, 6), new MeshBasicMaterial({ color: 0x4cc38a })))
spot.add(thing, seat, at, from, thumb, arrow, thumbArrow, ...dots)
let using: readonly Element[] | undefined, name = '', stated = ''

const { scene, camera, orbit, gizmo } = stage(() => {
  const way = at.position.clone().sub(from.position)
  arrow.position.copy(from.position)
  arrow.setDirection(way.clone().normalize())
  arrow.setLength(way.length(), 0.03, 0.015)
  const side = thumb.position.clone().sub(at.position)
  thumbArrow.position.copy(at.position)
  thumbArrow.setDirection(side.clone().normalize())
  thumbArrow.setLength(side.length(), 0.02, 0.01)
  // a grip is found again only when its statement changes: where the thing stands does not change how it is held
  const now = [at.position, from.position, thumb.position].map(v => v.toArray().map(x => x.toFixed(4))).join() + name + using
  if (now === stated || way.length() < 1e-4 || side.clone().cross(way).length() < 1e-4) return
  stated = now
  const t0 = performance.now()
  const found = grip(hand, thing, { at: at.position.clone(), from: way.clone().negate(), thumb: side, using })
  seat.position.copy(found.position)
  seat.quaternion.copy(found.quaternion)
  hand.pose(found.pose)
  dots.forEach((dot, i) => {
    const contact = Object.values(found.contacts)[i]
    dot.visible = contact.gap < 0.002
    dot.position.copy(contact.at)
  })
  const touching = Object.entries(found.contacts).filter(([, c]) => c.gap < 0.002).map(([e]) => e)
  el('hud').textContent =
    `grip found in ${(performance.now() - t0).toFixed(0)} ms\n` +
    `${found.fault ? `${(1000 * found.fault).toFixed(1)} mm from holding (the nearest grip it can make)` : 'holds'}\n` +
    `touching: ${touching.join(' ') || 'nothing'}`
})
camera.position.set(-0.45, 1.4, 0.75)
orbit.target.set(0, 1.1, 0)
scene.add(spot)

const control = gizmo()
const MODES: [string, Object3D, 'translate' | 'rotate'][] = [
  ['Move thing', spot, 'translate'],
  ['Turn thing', spot, 'rotate'],
  ['Grip point', at, 'translate'],
  ['Grip direction', from, 'translate'],
  ['Thumb side', thumb, 'translate'],
]
MODES.forEach(([label, object, mode], i) => {
  const button = document.createElement('button')
  button.textContent = label
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
  for (const option of options) box.append(new Option(option))
  box.onchange = () => pick(box.value)
  el('buttons').append(box)
  pick(options[0])
}
select(Object.keys(THINGS), picked => { thing.clear(); thing.add(THINGS[picked]()); name = picked })
select(Object.keys(GRIPS), picked => { using = GRIPS[picked] })
el('hint').textContent = 'A grip is stated by a point on the thing (red), the side the hand comes from (blue arrow) and the side the thumb goes to (green arrow), all in the thing\'s own frame: together they say exactly how the hand is turned. The grip found is where the hand goes on the thing and how its fingers hold it, and it stays so while the hand holds it: move or turn the thing and the hand goes with it unchanged. Pick what the gizmo moves with the buttons; change the thing or which fingers take part with the menus.'
