import { Body } from '@drawcall/animate'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { mannequin } from '../mannequin'
import { run } from '../stage'
import { BOX, type Box, SHELF, boxAt, carry } from './box'
import { shelve } from './shelve'

const boxMesh = new Mesh(
  new BoxGeometry(BOX.width, BOX.height, BOX.depth),
  new MeshStandardMaterial({ color: 0xc09050 }),
)
const board = new Mesh(
  new BoxGeometry(SHELF.width, SHELF.thick, SHELF.depth),
  new MeshStandardMaterial({ color: 0x808890 }),
)
board.position.set(0, SHELF.top - SHELF.thick / 2, SHELF.edge + SHELF.depth / 2)
// what the shelf stands on: a back behind the board
const back = new Mesh(new BoxGeometry(SHELF.width, SHELF.top, SHELF.thick), board.material)
back.position.set(0, SHELF.top / 2, SHELF.edge + SHELF.depth)
let body: Body
let box: Box

run({
  begin() {
    const man = mannequin()
    body = new Body(man)
    box = boxAt(2)
    body.play(shelve(body, box))
    return new Group().add(man, boxMesh, board, back)
  },
  update(delta) {
    body.update(delta)
    carry(box, body.hand.left.value, body.hand.right.value, delta)
    boxMesh.position.copy(box.position)
  },
  focus: () => body.hips.value.z,
  readout() {
    const where = box.held ? 'in the hands' : box.position.y > 1 ? 'on the shelf' : 'on the floor'
    return [`box       ${where}`, `story     ${body.playing ? 'playing' : 'over'}`].join('\n')
  },
})
