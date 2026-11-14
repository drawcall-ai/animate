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
import { clear, level } from './level'
import { rig } from './skeleton'
import { Soldier } from './soldier'

/** how far the aim turns for the mouse and for an arrow key held (rad a pixel, rad/s), and how far up and down it goes (rad) */
const TURN = { mouse: 0.0025, keys: 1.8, most: 0.7 }
/** where the camera is from his hips, as he aims: to his right, up and behind (m), and nearer down the sights */
const BEHIND = { right: 0.55, up: 0.65, back: 2.6, sights: 1.5 }

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}
const canvas = element('stage', HTMLCanvasElement)
const readout = element('readout', HTMLPreElement)

const renderer = new WebGLRenderer({ canvas, antialias: true })
const camera = new PerspectiveCamera(55)
const scene = new Scene()
scene.background = new Color(0x202020)
const sun = new DirectionalLight(0xffffff, 2.5)
sun.position.set(-3, 5, -2)
const world = level()
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
const soldier = new Soldier(rigged.scene, clear)
scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5), sun, new GridHelper(40, 40, 0x808080, 0x404040))
scene.add(world.drawn, soldier.shown)

const held = new Set<string>()
const aim = { yaw: 0, pitch: 0 }
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
  if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault()
})
addEventListener('keyup', (event) => held.delete(event.code))
canvas.addEventListener('click', () => canvas.requestPointerLock())
canvas.addEventListener('contextmenu', (event) => event.preventDefault())
addEventListener('mousedown', (event) => held.add(`Mouse${event.button}`))
addEventListener('mouseup', (event) => held.delete(`Mouse${event.button}`))
addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas) return
  // (his right is at -x as he faces +z: the aim turns that way for the mouse going right)
  aim.yaw -= event.movementX * TURN.mouse
  aim.pitch = Math.min(TURN.most, Math.max(-TURN.most, aim.pitch - event.movementY * TURN.mouse))
})

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
  world.update()

  // the camera is behind his right shoulder, looking the way he aims
  const ahead = new Vector3(
    Math.sin(aim.yaw) * Math.cos(aim.pitch),
    Math.sin(aim.pitch),
    Math.cos(aim.yaw) * Math.cos(aim.pitch),
  )
  const right = new Vector3(-Math.cos(aim.yaw), 0, Math.sin(aim.yaw))
  near += ((sights ? BEHIND.sights : BEHIND.back) - near) * Math.min(1, 8 * delta)
  const hips = soldier.body.hips.value
  camera.position
    .set(hips.x, soldier.body.size.stand + BEHIND.up, hips.z)
    .addScaledVector(right, BEHIND.right)
    .addScaledVector(ahead, -near)
  camera.lookAt(camera.position.clone().add(ahead))
  const [wide, high] = [canvas.clientWidth, canvas.clientHeight]
  camera.aspect = wide / high
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(wide, high, false)
  renderer.render(scene, camera)
  const { x, z } = soldier.body.hips.velocity
  readout.textContent = [
    `speed  ${Math.hypot(x, z).toFixed(1)} m/s   shots ${soldier.shots}   ${soldier.doing ?? ''}${world.near(hips, soldier.body.size.arm) ? '   E: press the button' : ''}`,
    ...soldier.errors.slice(-2).map((said) => `could not: ${said}`),
  ].join('\n')
})
