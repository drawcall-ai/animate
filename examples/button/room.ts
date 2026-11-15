import { RigidBody } from '@drawcall/physics'
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { PANEL, type Panel } from './panel'

/** where the wall stands along z, how far the floor reaches either way along x and z, and how thick it is (m) */
const ROOM = { wall: 4, wide: 8, long: 8, thick: 0.2, high: 4 }
/** how high above its button the lamp hangs, and how large it is (m) */
const LAMP = { above: 0.3, radius: 0.08 }

/** a panel on the wall, its button's lamp, and what shows both */
export type Lit = Panel & { lit: boolean; view: Group; light: Mesh; face: Mesh }

const paint = (color: number) => new MeshStandardMaterial({ color })

/** the floor and the wall behind the panels, which the world has as solid */
export function room() {
  const solid = new RigidBody({ bodyType: 'static' })
  const floor = new Mesh(new BoxGeometry(2 * ROOM.wide, ROOM.thick, 2 * ROOM.long), paint(0x707070))
  floor.position.y = -ROOM.thick / 2
  const wall = new Mesh(new BoxGeometry(2 * ROOM.wide, ROOM.high, ROOM.thick), paint(0x8a8a90))
  wall.position.set(0, ROOM.high / 2, ROOM.wall + PANEL.thick + ROOM.thick / 2)
  solid.add(floor, wall)
  return solid
}

/** a panel on the wall at `x`, its button's face `high` above the floor (m) */
export function lit(x: number, high: number): Lit {
  const button = new Vector3(x, high, ROOM.wall)
  const view = new Group()
  const board = new Mesh(new BoxGeometry(PANEL.wide, PANEL.high, PANEL.thick), paint(0x607080))
  board.position.set(x, high, ROOM.wall + PANEL.proud + PANEL.thick / 2)
  const face = new Mesh(new CylinderGeometry(PANEL.button, PANEL.button, PANEL.proud), paint(0xd03030))
  face.rotation.x = Math.PI / 2
  const light = new Mesh(new SphereGeometry(LAMP.radius), new MeshStandardMaterial({ color: 0x303030 }))
  light.position.set(x, high + PANEL.high / 2 + LAMP.above, ROOM.wall + PANEL.proud)
  view.add(board, face, light)
  return { button, pressed: false, lit: false, view, light, face }
}

/** the lamp as it is lit or dark, and the button as it is pressed in or out */
export function show(panel: Lit) {
  const { material } = panel.light
  if (!(material instanceof MeshStandardMaterial)) throw new Error('the lamp is not painted')
  material.color.set(panel.lit ? 0xffe070 : 0x303030)
  material.emissive.set(panel.lit ? 0xffc040 : 0x000000)
  panel.face.position.copy(panel.button).z += PANEL.proud / 2 + (panel.pressed ? PANEL.travel : 0)
}
