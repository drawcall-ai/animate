import { buildWorld } from '@drawcall/physics-rapier'
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { level } from './level'
import { rig } from './skeleton'
import { Soldier } from './soldier'

/** how far the aim turns for the mouse and for an arrow key held (rad a pixel, rad/s), and how far up and down it goes (rad) */
const TURN = { mouse: 0.0025, keys: 1.8, most: 0.7 }
/** where the camera is behind him, from his hips standing as he aims: to his right, up and behind (m), and nearer down the sights */
const BEHIND = { right: 0.55, up: 0.65, back: 2.6, sights: 1.5 }
/** how far off he is looked at, orbiting him (m) */
const ORBIT = 3
/** how wide the camera sees, behind him, at his eye and down the sights there (degrees), and how near it sees from his eye (m) */
const VIEW = { behind: 55, eye: 75, sights: 45, near: 0.1 }

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}
const canvas = element('stage', HTMLCanvasElement)
const readout = element('readout', HTMLPreElement)

const renderer = new WebGLRenderer({ canvas, antialias: true })
const camera = new PerspectiveCamera(VIEW.behind, 1, 0.05)
const scene = new Scene()
scene.background = new Color(0x202020)
const sun = new DirectionalLight(0xffffff, 2.5)
sun.position.set(-3, 5, -2)
const grid = new GridHelper(40, 40, 0x808080, 0x404040)
// (just above the floor, to be seen on it)
grid.position.y = 0.002
const world = level()
scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5), sun, grid, world.drawn)
const physics = await buildWorld({ scene })
// the model is rigged as it loads, from what the vitecache plugin rigged ahead, or in the browser when that is missing
readout.textContent = 'preparing the rig…'
const rigged = await rig().catch((error: unknown) => {
  readout.textContent = `could not rig him: ${error instanceof Error ? error.message : String(error)}`
  throw error
})
rigged.scene.traverse((part) => {
  // (the skinned meshes are bounded where the model rests, not where the body takes them)
  part.frustumCulled = false
})
const soldier = new Soldier(rigged.scene, physics)
/** his head, which is not drawn seen from his eye: it is about the camera */
const head = rigged.scene.getObjectByName('head')
scene.add(soldier.shown)

const held = new Set<string>()
const aim = { yaw: 0, pitch: 0 }
/** how the camera sees him: behind his shoulder, from his eye, or orbiting him, turned so (rad) */
let view: 'behind' | 'eye' = 'behind'
let orbit: { yaw: number; pitch: number } | undefined
const pressed = (...codes: string[]) => Number(codes.some((code) => held.has(code)))
addEventListener('keydown', (event) => {
  if (event.repeat) return
  held.add(event.code)
  if (event.code === 'KeyR') soldier.reload()
  if (event.code === 'KeyG') soldier.throw()
  if (event.code === 'Space' || event.code === 'KeyJ') soldier.jump()
  if (event.code === 'KeyE' && world.near(soldier.body.hips.value, soldier.body.size.arm)) soldier.press(world.panel)
  // a blow from in front of him
  if (event.code === 'KeyH') soldier.hit({ x: -Math.sin(aim.yaw), z: -Math.cos(aim.yaw) })
  if (event.code === 'KeyV') view = view === 'behind' ? 'eye' : 'behind'
  if (event.code === 'KeyO') orbit = orbit ? undefined : { yaw: aim.yaw + Math.PI, pitch: 0.2 }
  if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
})
addEventListener('keyup', (event) => held.delete(event.code))
canvas.addEventListener('click', () => canvas.requestPointerLock())
canvas.addEventListener('contextmenu', (event) => event.preventDefault())
addEventListener('mousedown', (event) => held.add(`Mouse${event.button}`))
addEventListener('mouseup', (event) => held.delete(`Mouse${event.button}`))
addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas) return
  // (his right is at -x as he faces +z: the aim, or the orbit, turns that way for the mouse going right)
  const turned = orbit ?? aim
  turned.yaw -= event.movementX * TURN.mouse
  turned.pitch = Math.min(TURN.most, Math.max(-TURN.most, turned.pitch - event.movementY * TURN.mouse))
})

/** the way an aim points, in the scene */
const along = ({ yaw, pitch }: { yaw: number; pitch: number }) =>
  new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))

let last: number | undefined
let near = BEHIND.back
renderer.setAnimationLoop((now) => {
  const delta = last === undefined ? 0 : Math.min(0.05, (now - last) / 1000)
  last = now
  aim.yaw += (pressed('ArrowLeft') - pressed('ArrowRight')) * TURN.keys * delta
  aim.pitch += (pressed('ArrowUp') - pressed('ArrowDown')) * TURN.keys * delta
  aim.pitch = Math.min(TURN.most, Math.max(-TURN.most, aim.pitch))
  const sights = Boolean(pressed('KeyF', 'Mouse2'))
  soldier.update(delta, {
    move: { x: pressed('KeyD') - pressed('KeyA'), z: pressed('KeyW') - pressed('KeyS') },
    yaw: aim.yaw,
    pitch: aim.pitch,
    sprint: Boolean(pressed('ShiftLeft', 'ShiftRight')),
    crouch: held.has('KeyC'),
    sights,
    fire: Boolean(pressed('KeyK', 'Mouse0')),
  })
  physics.update(delta)
  world.update()

  const hips = soldier.body.hips.value
  const ahead = along(aim)
  const eye = view === 'eye' && !orbit
  camera.fov = eye ? (soldier.aimed.sights ? VIEW.sights : VIEW.eye) : VIEW.behind
  camera.near = eye ? VIEW.near : 0.05
  head?.scale.setScalar(eye ? 0 : 1)
  if (orbit) {
    // round him, looking at his chest
    const chest = hips.clone().setY(hips.y + 0.4 * soldier.body.size.stand)
    camera.position.copy(chest).addScaledVector(along(orbit), -ORBIT)
    camera.lookAt(chest)
  } else if (view === 'eye') {
    // at his eye, looking along the aim
    camera.position.copy(soldier.body.eye('right'))
    camera.lookAt(camera.position.clone().add(ahead))
  } else {
    // behind his right shoulder, looking the way he aims: from where the capsule is, which goes smoother than he does
    const right = new Vector3(-Math.cos(aim.yaw), 0, Math.sin(aim.yaw))
    near += ((sights ? BEHIND.sights : BEHIND.back) - near) * Math.min(1, 8 * delta)
    camera.position
      .copy(soldier.capsule.position)
      .setY(soldier.capsule.position.y + soldier.body.size.stand + BEHIND.up)
      .addScaledVector(right, BEHIND.right)
      .addScaledVector(ahead, -near)
    camera.lookAt(camera.position.clone().add(ahead))
  }
  const [wide, high] = [canvas.clientWidth, canvas.clientHeight]
  camera.aspect = wide / high
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(wide, high, false)
  renderer.render(scene, camera)
  const { x, z } = soldier.capsule.velocity
  readout.textContent = `speed  ${Math.hypot(x, z).toFixed(1)} m/s   shots ${soldier.shots}   ${soldier.doing ?? ''}${world.near(hips, soldier.body.size.arm) ? '   E: press the button' : ''}`
})
