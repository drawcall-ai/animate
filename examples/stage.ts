import './stage.css'
import {
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { intent } from './intent'

function element<T extends Element>(id: string, kind: new () => T): T {
  const found = document.getElementById(id)
  if (!(found instanceof kind)) throw new Error(`#${id} is missing from the page`)
  return found
}

/** Shows a scene, at first from the side with +z to the right, keeping `focus` (z) in view as the view is dragged round it: `begin` starts it over and returns what to show, `update` advances it, `readout` says what happened. What the bodies in it mean to do is drawn over it with I, a button, or `?debug`. */
export function run(stage: { begin(): Object3D; update(delta: number): void; focus(): number; readout(): string }) {
  const canvas = element('stage', HTMLCanvasElement)
  const speed = element('speed', HTMLSelectElement)
  const readout = element('readout', HTMLPreElement)
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  const camera = new PerspectiveCamera(30, 1 / 0.42)
  camera.position.set(-6, 1.3, 0.6)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 1, 0.6)
  const scene = new Scene()
  scene.background = new Color(0x202020)
  const sun = new DirectionalLight(0xffffff, 2.5)
  sun.position.set(-3, 5, -2)
  scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5), sun, new GridHelper(40, 40, 0x808080, 0x404040))
  intent(scene)
  let shown = stage.begin()
  scene.add(shown)
  element('again', HTMLButtonElement).addEventListener('click', () => {
    scene.remove(shown)
    shown = stage.begin()
    scene.add(shown)
  })
  let last: number | undefined
  renderer.setAnimationLoop((now) => {
    stage.update(last === undefined ? 0 : Math.min(0.05, (now - last) / 1000) * Number(speed.value))
    last = now
    // the view goes along with what it keeps in view, turned and as near as it was left
    const along = stage.focus() + 0.6 - controls.target.z
    camera.position.z += along
    controls.target.z += along
    controls.update()
    // (at most 2 pixels drawn to a CSS pixel, which keeps a phone's frame rate)
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    renderer.setSize(canvas.clientWidth, Math.round(canvas.clientWidth * 0.42), false)
    renderer.render(scene, camera)
    readout.textContent = stage.readout()
  })
}
