import { Body } from 'animate-2d'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { PANEL, type Panel, panelAt } from './panel'
import { press } from './press'

// the panel behind the face of its button, and the button lying along z, out of it toward him
const board = new Mesh(
  new BoxGeometry(PANEL.wide, PANEL.high, PANEL.thick),
  new MeshStandardMaterial({ color: 0x607080 }),
)
const button = new Mesh(
  new CylinderGeometry(PANEL.button, PANEL.button, PANEL.proud),
  new MeshStandardMaterial({ color: 0xd03030 }),
)
button.rotation.x = Math.PI / 2
let body: Body
let panel: Panel
let pressed = false

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    panel = panelAt(1.6)
    pressed = false
    board.position.copy(panel.button).z += PANEL.proud + PANEL.thick / 2
    body.play(press(body, panel))
    return new Group().add(man, board, button)
  },
  update(delta) {
    body.update(delta)
    pressed ||= panel.pressed
    button.position.copy(panel.button).z += PANEL.proud / 2 + (panel.pressed ? PANEL.travel : 0)
  },
  focus: () => body.hips.value.z,
  readout() {
    return [
      `button    ${panel.pressed ? 'pressed' : pressed ? 'let go' : '…'}`,
      `story     ${body.playing ? 'playing' : 'over'}`,
    ].join('\n')
  },
})
