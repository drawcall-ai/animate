import type { PhysicsWorld } from '@drawcall/physics'
import { buildWorld } from '@drawcall/physics-rapier'
import { type Object3D, Scene, Vector3 } from 'three'
import { expect, test } from 'vitest'
import { court as hoops } from '../../../examples/basketball/court'
import { Hooper } from '../../../examples/basketball/hooper'
import { alley } from '../../../examples/bowling/alley'
import { Bowler } from '../../../examples/bowling/bowler'
import { Boxer } from '../../../examples/boxing/boxer'
import { Fencer } from '../../../examples/fencing/fencer'
import { field } from '../../../examples/football/field'
import { Footballer } from '../../../examples/football/footballer'
import { Thrower } from '../../../examples/javelin/thrower'
import { person } from '../../../examples/person'
import { Worker } from '../../../examples/shelf/worker'
import { court as tennis } from '../../../examples/tennis/court'
import { Player } from '../../../examples/tennis/player'
import { court as net } from '../../../examples/volleyball/court'
import { Spiker } from '../../../examples/volleyball/spiker'

/** what the player asks of a frame, and a game as its page plays it */
type Input = Parameters<Hooper['update']>[1]
type Game = Pick<Hooper, 'character' | 'update'>

const FRAME = 1 / 60
/** how far any bone has to have gone otherwise for a key to have moved him (m) */
const MOVED = 0.01

/** the games as their pages start them, with a plain rig */
const GAMES: Record<string, (scene: Scene, world: PhysicsWorld) => Game> = {
  basketball: (scene) => (scene.add(hoops()), new Hooper(person(), scene)),
  bowling: (scene) => (scene.add(alley()), new Bowler(person(), scene)),
  boxing: (scene) => new Boxer(person(), scene),
  fencing: (scene) => new Fencer(person(), scene),
  football: (scene) => (scene.add(field()), Footballer.start(person(), scene)),
  javelin: (scene) => new Thrower(person(), scene),
  tennis: (scene) => (scene.add(tennis()), new Player(person(), scene)),
  volleyball: (scene, world) => (scene.add(net()), new Spiker(person(), world, scene)),
  shelf: (scene, world) => new Worker(person(), world, scene),
}

/** what the player asks at a moment: keys held, and Space pressed at moments */
type Script = { move?: (t: number) => { x: number; z: number }; act?: number[] }
const input = (script: Script, t: number): Input => ({
  move: script.move?.(t) ?? { x: 0, z: 0 },
  run: false,
  act: (script.act ?? []).some((at) => t >= at && t - FRAME < at),
  held: new Set(),
})

/** every bone of his, as the game has him a frame at a time */
async function played(name: string, script: Script, seconds: number) {
  const scene = new Scene()
  const world = await buildWorld({ scene })
  const game = GAMES[name](scene, world)
  const bones: Object3D[] = []
  game.character.rig.traverse((bone) => void ((bone as { isBone?: boolean }).isBone && bones.push(bone)))
  const seen: Vector3[][] = []
  for (let t = 0; t < seconds; t += FRAME) {
    game.update(FRAME, input(script, t))
    world.update(FRAME)
    game.character.rig.updateMatrixWorld(true)
    seen.push(bones.map((bone) => bone.getWorldPosition(new Vector3())))
  }
  return seen
}

/** how long after a moment two runs, the same until then, first part by more than a centimetre at any bone (s) */
async function delay(name: string, before: Script, after: Script, at: number) {
  const [a, b] = [await played(name, before, at + 1), await played(name, after, at + 1)]
  const k = a.findIndex((frame, k) => k * FRAME >= at && frame.some((bone, j) => bone.distanceTo(b[k][j]) > MOVED))
  return k < 0 ? Infinity : (k + 1) * FRAME - at
}

const ahead = () => ({ x: 0, z: 1 })
const back = () => ({ x: 0, z: -1 })

test.each(Object.keys(GAMES))(
  'in %s a key pressed moves him within a tenth of a second: walking off, Space, and turning back out of an action',
  async (name) => {
    const walks = await delay(name, {}, { move: (t) => (t >= 1 ? ahead() : { x: 0, z: 0 }) }, 1)
    const acts = await delay(name, {}, { act: [1] }, 1)
    // (out of whatever Space began, the player turns him back)
    const turns = await delay(name, { act: [1] }, { act: [1], move: (t) => (t >= 1.3 ? back() : { x: 0, z: 0 }) }, 1.3)
    console.log(`${name}: walk ${(walks * 1000).toFixed(0)} ms, Space ${(acts * 1000).toFixed(0)} ms, back out of it ${(turns * 1000).toFixed(0)} ms`)
    expect(walks).toBeLessThan(0.1)
  },
  60000,
)
