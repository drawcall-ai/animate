import { Body } from '@drawcall/animate'
import { drawGait, drawPlan, Pen, shown } from '@drawcall/debug'
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { intent } from '../intent'
import { mannequin } from '../mannequin'
import { DRILLS, Drive } from './drills'
import { Walker } from './walker'

/** where the camera is from his hips, which way it never turns, and how high on him it looks (m) */
const CAMERA = { from: new Vector3(-2.5, 1.9, -1.4), at: 0.75 }
/** a footprint is left where a foot is this near the ground and this slow (m, m/s), one a print apart (m), so many kept a foot */
const PRINT = { low: 0.03, slow: 0.25, apart: 0.03, kept: 60 }
/** the frame a seek steps by (s) */
const FRAME = 1 / 60
const names = Object.keys(DRILLS)

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}

/** the ground, lined every half metre and boldly every metre, so a foot that slides shows */
function floor() {
  const drawn = document.createElement('canvas')
  drawn.width = drawn.height = 256
  const pen = drawn.getContext('2d')
  if (!pen) throw new Error('the page draws no 2d canvas')
  pen.fillStyle = '#2c3032'
  pen.fillRect(0, 0, 256, 256)
  pen.fillStyle = '#4a4e52'
  pen.fillRect(0, 127, 256, 2)
  pen.fillRect(127, 0, 2, 256)
  pen.fillStyle = '#6a7074'
  pen.fillRect(0, 0, 256, 4)
  pen.fillRect(0, 0, 4, 256)
  const texture = new CanvasTexture(drawn)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(400, 400)
  texture.anisotropy = 8
  const ground = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ map: texture }))
  ground.rotation.x = -Math.PI / 2
  return ground
}

/** the prints a foot leaves on the ground, the latest kept */
class Prints {
  readonly mesh: InstancedMesh
  private readonly at: Vector3[] = []
  private readonly was = new Vector3()

  constructor(color: number) {
    this.mesh = new InstancedMesh(new BoxGeometry(0.09, 0.006, 0.09), new MeshBasicMaterial({ color }), PRINT.kept)
    this.mesh.count = 0
  }

  /** the ankle is where it is a frame of `delta` on: low and slow, it leaves a print under it */
  update(ankle: Vector3, rest: number, delta: number) {
    const speed = delta > 0 ? ankle.distanceTo(this.was) / delta : Infinity
    this.was.copy(ankle)
    if (ankle.y > rest + PRINT.low || speed > PRINT.slow) return
    const last = this.at.at(-1)
    const ground = new Vector3(ankle.x, 0.006, ankle.z)
    if (last && last.distanceTo(ground) < PRINT.apart) return
    this.at.push(ground)
    if (this.at.length > PRINT.kept) this.at.shift()
    this.at.forEach((p, k) => this.mesh.setMatrixAt(k, new Matrix4().makeTranslation(p)))
    this.mesh.count = this.at.length
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear() {
    this.at.length = 0
    this.mesh.count = 0
  }
}

const canvas = element('stage', HTMLCanvasElement)
const readout = element('readout', HTMLPreElement)
const renderer = new WebGLRenderer({ canvas, antialias: true })
const camera = new PerspectiveCamera(45, 1, 0.05, 200)
const scene = new Scene()
scene.background = new Color(0x202020)
const sun = new DirectionalLight(0xffffff, 2.5)
sun.position.set(-3, 5, -2)
scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5), sun)
scene.add(floor())
const prints = { left: new Prints(0x4080ff), right: new Prints(0xff5040) }
scene.add(prints.left.mesh, prints.right.mesh)
intent(scene)
// (the frame gait draws its own layers: `?debug=gait,plan`)
const pen = new Pen()
const layers = shown(location.search)
scene.add(pen)

let man: Object3D
let body: Body | Walker
/** `?gait=frames` has the frame gait lead him in place of the body's own */
const frames = new URLSearchParams(location.search).get('gait') === 'frames'
let drive: Drive
let held = new Group()
let name = new URLSearchParams(location.search).get('drill') ?? names[0]
if (!DRILLS[name]) throw new Error(`there is no drill ${name}: ${names.join(', ')}`)

/** the drill starts over, a man standing at the middle */
function begin(drill: string) {
  name = drill
  scene.remove(held)
  man = mannequin()
  held = new Group().add(man)
  scene.add(held)
  body = frames ? new Walker(man) : new Body(man)
  drive = new Drive(body, DRILLS[name])
  prints.left.clear()
  prints.right.clear()
}

const ankle = (side: 'left' | 'right') => {
  const bone = man.getObjectByName(`${side}Foot`)
  if (!bone) throw new Error(`the mannequin has no ${side}Foot`)
  return bone.getWorldPosition(new Vector3())
}

function step(delta: number) {
  if (drive.time < drive.drill.seconds + 1) drive.update(delta)
  man.updateMatrixWorld(true)
  for (const side of ['left', 'right'] as const) prints[side].update(ankle(side), body.size.ankle, delta)
}

function draw() {
  const hips = body.hips.value
  camera.position.copy(hips).setY(0).add(CAMERA.from)
  camera.lookAt(hips.x, CAMERA.at, hips.z)
  const [wide, high] = [canvas.clientWidth, canvas.clientHeight]
  camera.aspect = wide / high
  camera.updateProjectionMatrix()
  // (at most 2 pixels drawn to a CSS pixel, which keeps a phone's frame rate)
  renderer.setPixelRatio(Math.min(2, devicePixelRatio))
  renderer.setSize(wide, high, false)
  if (body instanceof Walker) {
    pen.begin()
    const { gait } = body
    if (layers.has('gait')) drawGait(pen, gait.intent())
    if (layers.has('plan')) drawPlan(pen, [gait.hips, gait.feet.left, gait.feet.right].map((channel) => channel.intent()))
    pen.show()
  }
  renderer.render(scene, camera)
  const { x, z } = drive.velocity
  readout.textContent = `${name}   t ${drive.time.toFixed(2)} s   led ${Math.hypot(x, z).toFixed(1)} m/s`
}

begin(name)
// a button for each drill and one to start it again, which the keys press too
function pick(label: string, drill: () => string) {
  const button = document.createElement('button')
  button.textContent = label
  button.addEventListener('click', () => begin(drill()))
  element('keys', HTMLDivElement).append(button)
}
names.forEach((drill, k) => pick(`${(k + 1) % 10} ${drill}`, () => drill))
pick('R again', () => name)
addEventListener('keydown', (event) => {
  const digit = /^Digit(\d)$/.exec(event.code)
  if (digit) begin(names[(Number(digit[1]) + 9) % 10] ?? name)
  else if (event.code === 'KeyR') begin(name)
})
// a script can step the drill to a moment itself, frame by frame, the page no longer playing in real time
let seeking = false
Object.assign(window, {
  seek(time: number) {
    seeking = true
    element('keys', HTMLDivElement).hidden = true
    while (drive.time + FRAME / 2 < time) step(FRAME)
    draw()
  },
})
let last: number | undefined
renderer.setAnimationLoop((now) => {
  const delta = last === undefined ? 0 : Math.min(0.05, (now - last) / 1000)
  last = now
  if (seeking) return
  step(delta)
  draw()
})
