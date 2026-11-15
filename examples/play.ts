import './play.css'
import type { PhysicsWorld } from '@drawcall/physics'
import { buildWorld } from '@drawcall/physics-rapier'
import {
  Color,
  type Camera,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { Character } from './character'

/**
 * what the player asks of a frame: `move` along the ground in the scene, at most 1 long, whether to run, whether the
 * action key was pressed since the last frame, and the codes of the keys held (`KeyboardEvent.code`)
 */
export type Input = { move: { x: number; z: number }; run: boolean; act: boolean; held: ReadonlySet<string> }
/**
 * a game: its led character, a frame of it, a line or two on how it goes, and where what he plays with is, if a camera
 * is to keep that in view with him
 */
export type Game = {
  character: Character
  update(delta: number, input: Input): void
  readout(): string
  focus?(): Vector3 | undefined
}
/** makes a game in a scene the physics world simulates */
export type Start = (scene: Scene, world: PhysicsWorld) => Promise<Game>

/** how fast the arrow keys and a drag turn the camera round him (rad/s, rad a pixel) */
const TURN = { keys: 1.8, drag: 0.005 }
/** where the camera is behind him and how high above his crown, and where it looks, how high on him (of how high his hips stand) */
const BEHIND = { back: 3.6, up: 0.9, at: 1.3 }
/** the longest frame a game is stepped by (s): a slower frame is played slower */
const LONGEST = 0.05

/**
 * The keys as a game reads them: WASD moves him along the ground the way the camera looks, Shift runs, Space acts,
 * the arrows turn the camera round him, and every key held is told to the game. Pressed and let go by the page, or by
 * a script.
 */
export class Keys {
  readonly held = new Set<string>()
  /** which way the camera looks along the ground (rad about y, from +z toward +x) */
  yaw = 0
  private acted = false

  press(code: string) {
    if (code === 'Space' && !this.held.has(code)) this.acted = true
    this.held.add(code)
  }

  release(code: string) {
    this.held.delete(code)
  }

  /** what the keys ask of a frame of `delta` seconds, the camera turned as the arrows have been held */
  read(delta: number): Input {
    const on = (code: string) => Number(this.held.has(code))
    this.yaw += (on('ArrowLeft') - on('ArrowRight')) * TURN.keys * delta
    const [ahead, right] = [on('KeyW') - on('KeyS'), on('KeyD') - on('KeyA')]
    const far = Math.hypot(ahead, right) || 1
    // (looking along +z his right is -x)
    const [sin, cos] = [Math.sin(this.yaw), Math.cos(this.yaw)]
    const move = { x: (ahead * sin - right * cos) / far, z: (ahead * cos + right * sin) / far }
    const act = this.acted
    this.acted = false
    return { move, run: Boolean(on('ShiftLeft') || on('ShiftRight')), act, held: this.held }
  }
}

/** a lit scene and the physics world that simulates it */
export async function build() {
  const scene = new Scene()
  scene.background = new Color(0x202020)
  const sun = new DirectionalLight(0xffffff, 2.5)
  sun.position.set(-3, 5, -2)
  scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5), sun)
  return { scene, world: await buildWorld({ scene }) }
}

/** a rigged model as it loads, drawn wherever the body takes it */
export async function model(load: Promise<{ scene: Object3D }>) {
  const { scene } = await load
  // (the skinned meshes are bounded where the model rests, not where the body takes them)
  scene.traverse((part) => {
    part.frustumCulled = false
  })
  return scene
}

/** a frame of a game: it goes on as the input asks, and the world simulates what is let go in it */
export function frame(game: Game, world: PhysicsWorld, delta: number, input: Input) {
  game.update(delta, input)
  world.update(delta)
}

/** the camera behind him, the way the keys have it look, from where the world has him */
export function chase(camera: Camera, character: Character, yaw: number) {
  const { stand } = character.body.size
  const { position } = character.capsule
  const ahead = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
  const at = position.clone().setY(position.y + BEHIND.at * stand)
  camera.position
    .copy(position)
    .setY(position.y + (2 + BEHIND.up) * stand)
    .addScaledVector(ahead, -BEHIND.back * stand)
  camera.lookAt(at)
}

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}

/** Plays a game on the page: its #stage canvas, the keys, the camera behind him, and the #readout under it. */
export async function play(start: Start) {
  const canvas = element('stage', HTMLCanvasElement)
  const readout = element('readout', HTMLPreElement)
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  const camera = new PerspectiveCamera(55, 1, 0.05, 200)
  const { scene, world } = await build()
  readout.textContent = 'preparing the rig…'
  const game = await start(scene, world).catch((error: unknown) => {
    readout.textContent = `could not start: ${error instanceof Error ? error.message : String(error)}`
    throw error
  })
  const keys = new Keys()
  addEventListener('keydown', (event) => {
    if (event.repeat) return
    keys.press(event.code)
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
  })
  addEventListener('keyup', (event) => keys.release(event.code))
  canvas.addEventListener('pointermove', (event) => {
    if (event.buttons) keys.yaw -= event.movementX * TURN.drag
  })
  let last: number | undefined
  renderer.setAnimationLoop((now) => {
    const delta = last === undefined ? 0 : Math.min(LONGEST, (now - last) / 1000)
    last = now
    frame(game, world, delta, keys.read(delta))
    chase(camera, game.character, keys.yaw)
    const [wide, high] = [canvas.clientWidth, canvas.clientHeight]
    camera.aspect = wide / high
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(wide, high, false)
    renderer.render(scene, camera)
    const { errors } = game.character
    readout.textContent = game.readout() + (errors.length ? `\n${errors[errors.length - 1]}` : '')
  })
}
